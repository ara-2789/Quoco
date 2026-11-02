import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getMaterialInwardList } from '@/lib/capture/pm-queries'
import { PM_EMPTY_STATE, PM_LIST_TRUNCATED, PM_LOAD_ERROR, PM_NOT_A_PM_STATE, PM_PAGE_TITLE } from '@/lib/capture/pm-copy'
import { DeliveryRow } from '@/components/material-inward/delivery-row'

// PR-D: PM list "Material Inward" (docs/plans/pr-d-plan.md). D2: never cached; the 15-minute rule and "invoice
// expected" day counts depend on the clock at request time. The session client reads cookies, which already makes
// this dynamic; the explicit export keeps it so under refactor.
//
// ROUTE ACCESS: no role gate, no redirect (same as hindrances/page.tsx). The database decides what a viewer sees: the
// capture tables' SELECT policies return rows only to an ACTIVE PM of the row's project (049:906-960). getProfile()
// does not check users.status, so an inactive user lands on the "not a PM"/empty state, never on data.
//
// The nav entry is deliberately absent (hidden until the C6 entry gate); the page is reachable by URL.
export const dynamic = 'force-dynamic'

export default async function MaterialInwardPage() {
  const supabase = await createClient()
  const profile = await getProfile()
  const result = await getMaterialInwardList(supabase, { id: profile.id, tenant_id: profile.tenant_id }, new Date())

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{PM_PAGE_TITLE}</h1>
      </div>
      {result.status === 'error' ? (
        <p className="text-sm text-gray-700">{PM_LOAD_ERROR}</p>
      ) : result.status === 'not-a-pm' ? (
        <p className="text-sm text-gray-700">{PM_NOT_A_PM_STATE}</p>
      ) : result.items.length === 0 ? (
        <p className="text-sm text-gray-700">{PM_EMPTY_STATE}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => (
            <DeliveryRow key={item.id} item={item} />
          ))}
          {result.truncated && <p className="text-sm text-gray-700">{PM_LIST_TRUNCATED}</p>}
        </div>
      )}
    </div>
  )
}
