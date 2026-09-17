import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isProjectPm } from '@/lib/auth/is-project-pm'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D1;
// verdict). The daily-log detail page's own photo read -- keyed on a
// specific daily_log_id, both phases, unlike lib/dpr/select-photo-
// candidates.ts's S2a (evening only, keyed on project+engineer+date). New
// file, not a modification to any B1/B2 file.

export interface DailyLogPhotoItem {
  id: string
  kind: 'daily_log'
  expiresAt: string
}

interface DailyLogPhotoRow {
  id: string
  phase: 'morning' | 'evening'
  photo_url: string | null
  expires_at: string
}

export interface SelectDailyLogPhotosParams {
  tenantId: string
  dailyLogId: string
}

export interface DailyLogPhotoSectionsData {
  morning: DailyLogPhotoItem[]
  evening: DailyLogPhotoItem[]
}

/**
 * S2's own "never select by date/tenant alone" discipline, applied here:
 * always filtered by BOTH tenant_id and daily_log_id, never one alone.
 * Tombstoned rows (photo_url NULL) excluded. Ordered oldest-received
 * first, per-phase, mirroring select-photo-candidates.ts's own ordering
 * convention.
 */
export async function selectDailyLogPhotos(
  params: SelectDailyLogPhotosParams,
  client: SupabaseClient<Database>,
): Promise<DailyLogPhotoSectionsData> {
  const { data, error } = await client
    .from('daily_log_photos')
    .select('id, phase, photo_url, expires_at')
    .eq('tenant_id', params.tenantId)
    .eq('daily_log_id', params.dailyLogId)
    .not('photo_url', 'is', null)
    .order('received_at', { ascending: true })
  if (error) throw error

  const morning: DailyLogPhotoItem[] = []
  const evening: DailyLogPhotoItem[] = []
  for (const row of (data ?? []) as unknown as DailyLogPhotoRow[]) {
    if (!row.photo_url) continue
    const item: DailyLogPhotoItem = { id: row.id, kind: 'daily_log', expiresAt: row.expires_at }
    if (row.phase === 'morning') morning.push(item)
    else evening.push(item)
  }
  return { morning, evening }
}

/**
 * D3's gate for the daily-log detail page: project_members.role='pm' for
 * THIS log's own project, via the shared isProjectPm (never
 * profile.role/users.role -- R1 revision, docs/reviews/stage5a-review-
 * package.md §4 D3). Returns null for a non-PM (or a tenant-less caller)
 * -- the page must render NOTHING when this is null, never an empty
 * section (D3/C7).
 */
export async function resolveDailyLogPhotoSections(
  client: SupabaseClient<Database>,
  viewerId: string,
  tenantId: string | null,
  projectId: string,
  dailyLogId: string,
): Promise<DailyLogPhotoSectionsData | null> {
  const isPm = await isProjectPm(client, viewerId, projectId)
  if (!isPm || !tenantId) return null
  return selectDailyLogPhotos({ tenantId, dailyLogId }, client)
}
