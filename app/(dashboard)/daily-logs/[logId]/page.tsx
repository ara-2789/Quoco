import { notFound } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDailyLogDetail } from '@/lib/daily-logs/query'
import { getDprDeliveryState, deriveDprDeliveryCopy } from '@/lib/daily-logs/dpr-delivery-note'
import { LogDetailView } from '@/components/daily-logs/log-detail-view'

// DASH-03 Rule 4.3 inline correction — detail route. Drill-down from the
// Daily Logs board card (no modal — see the board card link change in
// ../page.tsx). Read access is NOT role-gated (any project_members row, any
// role); only the edit affordances inside LogDetailView's children are
// gated on role === 'pm' (§10 of the build plan).
export default async function DailyLogDetailPage({
  params,
}: {
  params: Promise<{ logId: string }>
}) {
  const { logId } = await params
  const supabase = await createClient()
  const profile = await getProfile()

  const result = await getDailyLogDetail(supabase, profile.id, logId)

  // Same-tenant non-member and genuinely-missing rows are deliberately
  // indistinguishable — both 404, neither leaks which case it was.
  if (result.status === 'not-found') notFound()
  if (result.status === 'error') return <DetailErrorState logId={logId} />

  const dprState = await getDprDeliveryState(
    supabase,
    result.data.projectId,
    result.data.engineerId,
    result.data.logDate,
  )
  const dprDeliveryCopy = deriveDprDeliveryCopy(dprState)

  return (
    <LogDetailView
      data={result.data}
      dprDeliveryCopy={dprDeliveryCopy}
      viewerRole={profile.role}
      now={new Date()}
    />
  )
}

// Same B1 discipline as the board's ErrorState — a failed read must never
// read as "nothing here."
function DetailErrorState({ logId }: { logId: string }) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-12 text-center">
        <div className="mb-2 flex items-center justify-center gap-2 text-red-700">
          <CircleAlert className="h-5 w-5" aria-hidden="true" />
          <p className="text-sm font-semibold">Couldn&apos;t load this entry</p>
        </div>
        <p className="mx-auto max-w-md text-sm text-red-700/80">
          Something went wrong reading this check-in. Please retry.
        </p>
        <a
          href={`/daily-logs/${logId}`}
          className="mt-3 inline-block rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Retry
        </a>
      </div>
    </div>
  )
}
