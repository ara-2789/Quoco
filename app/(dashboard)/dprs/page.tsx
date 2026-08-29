import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { StatusChip } from '@/components/ui/status-chip'
import { deriveDprArchiveStatus } from '@/lib/dpr/archive-status'

type DprRow = {
  id: string
  log_date: string
  content: string | null
  generation_status: string
  delivery_status: string
  engineer_id: string
  projects: { name: string } | null
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function DprsPage() {
  const supabase = await createClient()
  const profile = await getProfile()

  const { data: memberRows } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', profile.id)

  const projectIds = (memberRows ?? []).map((m) => m.project_id as string)

  let dprs: DprRow[] = []
  let queryFailed = false
  let engineerNameById = new Map<string, string | null>()

  if (projectIds.length > 0) {
    // No `.not('content', 'is', null)` filter — every row for an eligible
    // project surfaces, generated or not. See lib/dpr/archive-status.ts's
    // header for why: filtering out null-content rows made a failed or
    // still-running generation render identically to a night nothing was
    // attempted, which is the exact absence-vs-failure conflation this
    // product exists to catch.
    //
    // `content` IS still selected, even though the list never renders the
    // text — deriveDprArchiveStatus needs to know whether it's null to tell
    // "generated" apart from every other state, and PostgREST has no way to
    // project "content IS NOT NULL" as a boolean without a generated column
    // (a migration, out of scope for this PR — "No migration" per the plan).
    // The value itself is discarded immediately after the map below; the
    // detail route is still the only place the text is ever displayed. This
    // is a real, smaller tradeoff (bytes over the wire) than the one
    // originally flagged (a needless column with no purpose at all) — worth
    // stating plainly rather than silently reintroducing the column.
    const { data, error } = await supabase
      .from('dprs')
      .select('id, log_date, content, generation_status, delivery_status, engineer_id, projects(name)')
      .in('project_id', projectIds)
      .order('log_date', { ascending: false })

    if (error) {
      queryFailed = true
      Sentry.captureException(error, { tags: { feature: 'dpr-archive-list' } })
    } else {
      dprs = (data ?? []) as unknown as DprRow[]

      // Engineer names, fetched separately rather than via an embedded
      // join on the composite (engineer_id, tenant_id) FK — PostgREST's
      // support for embedding through a composite foreign key is not
      // something this codebase has verified, so this avoids depending on
      // it unverified (CLAUDE.md §0: verify by observation, don't assume).
      const engineerIds = Array.from(new Set(dprs.map((d) => d.engineer_id)))
      if (engineerIds.length > 0) {
        const { data: engineers } = await supabase.from('users').select('id, full_name').in('id', engineerIds)
        const nameById = new Map((engineers ?? []).map((e) => [e.id as string, e.full_name as string | null]))
        engineerNameById = nameById
      }
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Daily Progress Reports</h1>
        <p className="text-gray-500 text-sm mt-1">
          AI-generated DPRs from WhatsApp check-ins across your projects.
        </p>
      </div>

      {queryFailed ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-12 text-center">
          <p className="text-red-700 font-medium">Couldn&apos;t load reports.</p>
          <p className="text-red-600 text-sm mt-2">
            Something went wrong loading the archive. This has been reported — try
            refreshing, or check back shortly.
          </p>
        </div>
      ) : dprs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-700 font-medium">No DPRs generated yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            DPRs are created automatically each evening after the WhatsApp check-in.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* overflow-hidden above clips the rounded corners, not scrolling
              — it must stay for that. Horizontal scroll lives on this INNER
              wrapper instead, so a narrow viewport scrolls the table without
              losing the card's rounding. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Project</th>
                <th className="px-4 py-3 font-medium text-gray-600">Engineer</th>
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {dprs.map((dpr) => {
                const status = deriveDprArchiveStatus(dpr)
                const clickable = status.state === 'generated'
                return (
                  <tr
                    key={dpr.id}
                    className={`relative border-b border-gray-100 ${clickable ? 'hover:bg-gray-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {dpr.projects?.name ?? '—'}
                      {/* Single real anchor, absolutely positioned to cover the
                          whole row — the standard clickable-table-row pattern.
                          A <Link> cannot wrap multiple <td> siblings without
                          producing invalid table nesting (a <td> or an <a>
                          containing other <td>s), so the link lives inside
                          this one cell instead. */}
                      {clickable && (
                        <Link
                          href={`/dprs/${dpr.id}`}
                          className="absolute inset-0"
                          aria-label={`View report for ${dpr.projects?.name ?? 'project'}, ${engineerNameById.get(dpr.engineer_id) ?? 'engineer'}, ${formatDate(dpr.log_date)}`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{engineerNameById.get(dpr.engineer_id) ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(dpr.log_date)}</td>
                    <td className="px-4 py-3">
                      <StatusChip variant={status.variant} label={status.label} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
