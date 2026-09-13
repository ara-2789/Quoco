import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

// Stage 0 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage0-storage-setup-plan.md). This module is
// the ENTIRE access-control boundary for photo objects -- Aravind's
// 2026-09-13 decision explicitly rejected Storage RLS on storage.objects in
// favour of this: service_role only, every read gated by an application-code
// membership check before a short-lived signed URL is ever minted.
//
// CONSEQUENCE, RECORDED HERE TOO (not just in the plan doc): there is no
// second, database-level barrier behind this function. If its logic has a
// bug, there is nothing else standing between one tenant's photos and
// another's -- this is why the cross-tenant isolation test
// (test/storage-photo-access.test.ts) is written as the actual verification
// that isolation exists, not a confirmation of a second layer already
// believed sound.

export const PHOTO_BUCKET = 'daily-log-photos'

// "Short means minutes, not hours or days" (Aravind, 2026-09-13). 5 minutes
// is enough for one dashboard page render (including a slow connection) but
// short enough that a leaked URL (screenshot, browser history, a shared
// link) stops being useful almost immediately.
export const SIGNED_URL_TTL_SECONDS = 300

export interface GetSignedPhotoUrlParams {
  /**
   * The object's path exactly as stored, e.g.
   * "{tenant_id}/{daily_log_id}/{photo_id}.jpg" (docs/plans/
   * stage0-storage-setup-plan.md §3's convention). The tenant segment is
   * NEVER trusted for authorization -- see extractDailyLogId's own comment.
   */
  objectPath: string
  /** public.users.id of the requesting caller -- already resolved by the
   * caller from whatever session mechanism applies (a dashboard route's own
   * Supabase Auth session, today; nothing else calls this yet). This
   * function does no session/cookie parsing of its own -- that is the
   * caller's job, same division of responsibility as every other
   * lib/*.ts function in this codebase that takes a resolved id rather
   * than a request object (e.g. resolveProjectPMEmails). */
  callerUserId: string
  /** Injected client, defaulting to createServiceClient() (today's exact
   * behaviour) when omitted -- same shape as every other function in this
   * codebase that takes an optional supabaseClient (applyEveningFlowTurn,
   * resolveProjectPMEmails, enqueueJob, ...). */
  supabaseClient?: SupabaseClient
}

/**
 * Extract the daily_log_id segment from an object path shaped
 * "{tenant_id}/{daily_log_id}/{photo_id}.{ext}". Returns null for anything
 * that doesn't have exactly three path segments -- malformed input refuses
 * immediately, before any query runs.
 *
 * DELIBERATELY DOES NOT RETURN OR USE THE TENANT SEGMENT. The path's tenant
 * segment exists for human-readable bucket organisation only; it is never
 * consulted for authorization. The real tenant/project boundary is derived
 * entirely from the database (daily_logs.project_id -> project_members),
 * keyed on daily_log_id alone -- a path with a mismatched or fabricated
 * tenant segment gains nothing, because that segment is never read again
 * after this function returns.
 */
function extractDailyLogId(objectPath: string): string | null {
  const parts = objectPath.split('/')
  if (parts.length !== 3) return null
  const dailyLogId = parts[1]
  return dailyLogId && dailyLogId.length > 0 ? dailyLogId : null
}

/**
 * The entire access-control decision for a photo object, plus (only on
 * success) minting the short-lived signed URL a caller actually needs.
 *
 * Returns null on ANY failure to authorize -- malformed path, unknown
 * daily_log_id, caller not a PM on the owning project, or a Storage error
 * minting the URL. Deliberately ONE failure shape: a caller can never
 * distinguish "wrong tenant" from "wrong role" from "object doesn't exist"
 * from "malformed path" from this function's return value alone. Never
 * throws for an authorization failure -- only for a genuine infrastructure
 * error the caller could not have anticipated (a network-level Supabase
 * client failure), which is not caught here and propagates like any other
 * unexpected error in this codebase's other lib/*.ts functions.
 */
export async function getSignedPhotoUrl(
  params: GetSignedPhotoUrlParams,
): Promise<string | null> {
  const supabase = params.supabaseClient ?? createServiceClient()

  const dailyLogId = extractDailyLogId(params.objectPath)
  if (!dailyLogId) return null

  const { data: log, error: logError } = await supabase
    .from('daily_logs')
    .select('project_id')
    .eq('id', dailyLogId)
    .maybeSingle<{ project_id: string }>()
  if (logError || !log) return null

  const { data: membership, error: memberError } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', log.project_id)
    .eq('user_id', params.callerUserId)
    .eq('role', 'pm')
    .maybeSingle<{ user_id: string }>()
  if (memberError || !membership) return null

  const { data: signed, error: signError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(params.objectPath, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed?.signedUrl) return null

  return signed.signedUrl
}
