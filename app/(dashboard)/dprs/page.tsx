import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'

type DprRow = {
  id: string
  log_date: string
  content: string | null
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

  if (projectIds.length > 0) {
    const { data } = await supabase
      .from('dprs')
      .select('id, log_date, content, projects(name)')
      .in('project_id', projectIds)
      .not('content', 'is', null)
      .order('log_date', { ascending: false })

    dprs = (data ?? []) as unknown as DprRow[]
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Daily Progress Reports</h1>
        <p className="text-gray-500 text-sm mt-1">
          AI-generated DPRs from WhatsApp check-ins across your projects.
        </p>
      </div>

      {dprs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-700 font-medium">No DPRs generated yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            DPRs are created automatically each evening after the WhatsApp check-in.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Project</th>
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody>
              {dprs.map((dpr) => (
                <tr key={dpr.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {dpr.projects?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(dpr.log_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
