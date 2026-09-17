import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { PhotoKind } from '@/lib/storage/photo-access'

// Stage 5a, build slice B2 (docs/reviews/stage5a-review-package.md, D7;
// verdict Q3). The "which photos" half of the split described there:
// given a DPR row's own key, return the ordered photo list -- NO readiness
// logic (F1 lives only in lib/dpr/select-photos.ts's own selectDprPhotos
// wrapper, never here -- D9's own requirement), NO Storage calls, NO caps.
// This file imports nothing email-, Sentry-, or Storage-related -- it is a
// pure DB selector, callable equally by the Owner DPR email wrapper
// (lib/dpr/select-photos.ts) and by a future dashboard page (B3, not yet
// built) with no email-specific baggage pulled into either caller's bundle.
//
// CONSUMER CONTRACT, FOR B3 (or any future caller): `photoUrl` below is a
// raw Supabase Storage object path, NEVER a browser-renderable URL -- it
// must never be written into HTML (an <img src>, a link, anything a
// browser dereferences directly). The ONLY sanctioned way to render one of
// these photos is the already-built route, `/api/photos/[kind]/[id]`
// (app/api/photos/[kind]/[photoId]/route.ts, stage 5a B1), using this
// candidate's own `id` and `kind` -- that route re-derives its own signed
// URL under its own tenant/PM authorization check; nothing here authorizes
// anything on its own. Do not shortcut that by minting a signed URL
// directly from `photoUrl` at the call site.
//
// S2 -- SELECTION, PER DPR ROW (project_id, engineer_id, log_date), ALWAYS
// ALSO FILTERED BY tenant_id (unchanged from the pre-split selectDprPhotos,
// lib/dpr/select-photos.ts's own history):
//   a. Evening photos: daily_log_photos for the daily_logs row matching
//      (project_id, engineer_id, log_date), phase='evening', photo_url NOT
//      NULL, ordered by received_at. Morning (attendance) photos are NEVER
//      included -- the phase='evening' filter is the entire mechanism.
//   b. THEN hindrance photos: hindrance_photos joined to hindrances where
//      hindrances.project_id = project_id AND hindrances.reported_by =
//      engineer_id AND hindrances.report_date = log_date (migration 046),
//      photo_url NOT NULL, ordered by received_at.
//   Never select by date or tenant alone -- every query below carries the
//   full (tenant_id, project_id, engineer_id/reported_by, log_date/
//   report_date) key, so a same-tenant sibling project or a same-date row
//   in a different tenant can never contribute a photo.
//
// D9 (docs/reviews/stage5a-review-package.md:414-425): this function is
// deliberately indifferent to evening_photos_status / hindrances.photos_
// status -- it returns whatever photo_url rows exist right now, uploads
// still in progress elsewhere notwithstanding. A page consumer (B3) that
// wants "whatever exists now" calls this directly; the email path's own
// readiness gate (F1) lives entirely in lib/dpr/select-photos.ts, never
// here.

export interface DprPhotoCandidate {
  id: string
  photoUrl: string
  kind: PhotoKind // 'daily_log' for evening photos, 'hindrance' for hindrance photos
  expiresAt: string // the row's generated expires_at, raw ISO string as returned by supabase-js
}

interface DailyLogIdRow {
  id: string
}

interface HindranceIdRow {
  id: string
}

interface EveningPhotoRow {
  id: string
  photo_url: string | null
  expires_at: string
}

interface HindrancePhotoRow {
  id: string
  photo_url: string | null
  expires_at: string
}

export interface SelectDprPhotoCandidatesParams {
  tenantId: string
  projectId: string
  engineerId: string
  logDate: string
}

export async function selectDprPhotoCandidates(
  params: SelectDprPhotoCandidatesParams,
  client?: SupabaseClient,
): Promise<DprPhotoCandidate[]> {
  const supabase = client ?? createServiceClient()
  const { tenantId, projectId, engineerId, logDate } = params

  // --- S2a: evening photos, via the one daily_logs row for this key. ---
  const { data: dailyLog, error: dailyLogError } = await supabase
    .from('daily_logs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('engineer_id', engineerId)
    .eq('log_date', logDate)
    .maybeSingle<DailyLogIdRow>()
  if (dailyLogError) throw dailyLogError

  const eveningCandidates: DprPhotoCandidate[] = []
  if (dailyLog) {
    const { data: eveningPhotos, error: eveningError } = await supabase
      .from('daily_log_photos')
      .select('id, photo_url, expires_at')
      .eq('tenant_id', tenantId)
      .eq('daily_log_id', dailyLog.id)
      .eq('phase', 'evening')
      .not('photo_url', 'is', null)
      .order('received_at', { ascending: true })
    if (eveningError) throw eveningError
    for (const row of (eveningPhotos ?? []) as EveningPhotoRow[]) {
      if (row.photo_url) eveningCandidates.push({ id: row.id, photoUrl: row.photo_url, kind: 'daily_log', expiresAt: row.expires_at })
    }
  }

  // --- S2b: hindrance photos, via every hindrance matching this key. ---
  const { data: hindranceRows, error: hindranceError } = await supabase
    .from('hindrances')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('reported_by', engineerId)
    .eq('report_date', logDate)
  if (hindranceError) throw hindranceError

  const hindranceIds = ((hindranceRows ?? []) as HindranceIdRow[]).map((r) => r.id)
  const hindranceCandidates: DprPhotoCandidate[] = []
  if (hindranceIds.length > 0) {
    const { data: hindrancePhotos, error: hpError } = await supabase
      .from('hindrance_photos')
      .select('id, photo_url, expires_at')
      .eq('tenant_id', tenantId)
      .in('hindrance_id', hindranceIds)
      .not('photo_url', 'is', null)
      .order('received_at', { ascending: true })
    if (hpError) throw hpError
    for (const row of (hindrancePhotos ?? []) as HindrancePhotoRow[]) {
      if (row.photo_url) hindranceCandidates.push({ id: row.id, photoUrl: row.photo_url, kind: 'hindrance', expiresAt: row.expires_at })
    }
  }

  // S2's own ordering: evening before hindrance.
  return [...eveningCandidates, ...hindranceCandidates]
}
