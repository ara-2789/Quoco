import type { SupabaseClient } from '@supabase/supabase-js'
import { isProjectPm } from '@/lib/auth/is-project-pm'
import { selectDprPhotoCandidates } from '@/lib/dpr/select-photo-candidates'
import type { DprPhotoSectionsData } from '@/components/dprs/dpr-photo-sections'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D2/
// D3/D8/D9). New file -- NOT a modification to lib/dpr/select-photo-
// candidates.ts (import only) or any other forbidden lib/dpr file.
//
// Deliberately kept OUT of app/(dashboard)/dprs/[id]/page.tsx: that page
// module is imported directly by tests (test/dpr-detail.test.ts,
// test/dpr-page-photos.test.ts) for its OTHER exported function
// (getDprDetail); this module must stay free of any 'server-only'-tainted
// import (lib/auth/profile.ts) so importing it under vitest never drags
// in a package this repo doesn't actually install for that context. Same
// reasoning as lib/auth/profile.ts's own split from profile-query.ts.

export interface DprPhotoSectionsInput {
  tenant_id: string
  project_id: string
  engineer_id: string
  log_date: string
}

/**
 * Gate: project_members.role='pm' for this DPR's own project, via the
 * shared isProjectPm (never profile.role/users.role -- R1 revision). null
 * means "not a PM" -- the page must render no photo markup at all. D9: no
 * readiness gate here -- selectDprPhotoCandidates (B2, IMPORT ONLY) never
 * had one; this just calls it directly and splits the result by kind,
 * preserving each half's relative order (evening-before-hindrance is
 * already S2's own contract). Callers render regardless of dpr.content
 * being null (Aravind, 2026-09-17, unknown #3 resolved).
 */
export async function resolveDprPhotoSections(
  client: SupabaseClient,
  viewerId: string,
  dpr: DprPhotoSectionsInput,
): Promise<DprPhotoSectionsData | null> {
  const isPm = await isProjectPm(client, viewerId, dpr.project_id)
  if (!isPm) return null

  const candidates = await selectDprPhotoCandidates(
    { tenantId: dpr.tenant_id, projectId: dpr.project_id, engineerId: dpr.engineer_id, logDate: dpr.log_date },
    client,
  )
  return {
    evening: candidates.filter((c) => c.kind === 'daily_log'),
    hindrance: candidates.filter((c) => c.kind === 'hindrance'),
  }
}
