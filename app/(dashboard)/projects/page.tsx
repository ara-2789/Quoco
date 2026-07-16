import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'

type ProjectRow = {
  id: string
  name: string
  status: string
  contract_value: number | null
  start_date: string | null
  expected_end_date: string | null
}

type MemberRow = {
  role: string
  projects: ProjectRow | null
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    on_hold: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-gray-100 text-gray-600',
    in_bidding: 'bg-blue-100 text-blue-700',
    bids_submitted: 'bg-purple-100 text-purple-700',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

function formatDate(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function ProjectsPage() {
  const supabase = await createClient()
  const profile = await getProfile()

  const { data: members } = await supabase
    .from('project_members')
    .select('role, projects(id, name, status, contract_value, start_date, expected_end_date)')
    .eq('user_id', profile.id)

  const rows = ((members ?? []) as unknown as MemberRow[]).filter(
    (m): m is MemberRow & { projects: ProjectRow } => m.projects !== null,
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Projects</h1>
          <p className="text-gray-500 text-sm mt-1">All construction projects in your workspace.</p>
        </div>
        <Link
          href="/projects/new"
          className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          New Project
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-500 text-sm">No projects yet.</p>
          <Link
            href="/projects/new"
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
          >
            Create your first project →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Project</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Contract Value</th>
                <th className="px-4 py-3 font-medium text-gray-600">Start Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">End Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">Your Role</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ role, projects: p }) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(p.status)}`}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {p.contract_value !== null
                      ? `₹${Number(p.contract_value).toLocaleString('en-IN')}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(p.start_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(p.expected_end_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
