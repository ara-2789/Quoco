import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type Project = {
  id: string
  name: string
  status: string
  contract_value: number | null
  start_date: string | null
  expected_end_date: string | null
  created_at: string
}

type UserRow = {
  id: string
  full_name: string | null
  role: string
}

type MemberRow = {
  role: string
  users: UserRow | null
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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: project }, { data: members }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, contract_value, start_date, expected_end_date, created_at')
      .eq('id', id)
      .single<Project>(),
    supabase
      .from('project_members')
      .select('role, users(id, full_name, role)')
      .eq('project_id', id),
  ])

  if (!project) notFound()

  const teamMembers = ((members ?? []) as unknown as MemberRow[]).filter(
    (m): m is MemberRow & { users: UserRow } => m.users !== null,
  )

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-2">
        <Link href="/projects" className="text-sm text-gray-500 hover:text-gray-700">
          ← Projects
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-gray-500 text-sm mt-1">
            Created {formatDate(project.created_at.split('T')[0])}
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full ${statusBadge(project.status)}`}>
          {project.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
          Project Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-gray-500">Contract Value</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {project.contract_value !== null
                ? `₹${Number(project.contract_value).toLocaleString('en-IN')}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {project.status.replace(/_/g, ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Start Date</dt>
            <dd className="font-medium text-gray-900 mt-0.5">{formatDate(project.start_date)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Expected End Date</dt>
            <dd className="font-medium text-gray-900 mt-0.5">
              {formatDate(project.expected_end_date)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Team Members
          </h2>
        </div>
        {teamMembers.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-500">No members found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-6 py-3 font-medium text-gray-600">Name</th>
                <th className="px-6 py-3 font-medium text-gray-600">User Role</th>
                <th className="px-6 py-3 font-medium text-gray-600">Project Role</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map(({ role: projectRole, users: u }) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-6 py-3 font-medium text-gray-900">{u.full_name ?? '—'}</td>
                  <td className="px-6 py-3 text-gray-600">{u.role}</td>
                  <td className="px-6 py-3 text-gray-600">{projectRole}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
