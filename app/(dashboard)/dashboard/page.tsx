import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { ProjectStatusTag } from '@/components/ui/project-status-tag'

type ProjectRow = {
  id: string
  name: string
  status: string
  contract_value: number | null
}

type MemberRow = {
  project_id: string
  projects: ProjectRow | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  // getProfile() gates auth (redirects if unauthenticated) and fail-louds on a
  // missing profile — so profile is always present past this line.
  const profile = await getProfile()

  const { data: members } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name, status, contract_value)')
    .eq('user_id', profile.id)

  const firstName = profile.full_name?.split(' ')[0] ?? 'there'
  const projects = ((members ?? []) as unknown as MemberRow[])
    .map((m) => m.projects)
    .filter((p): p is ProjectRow => p !== null)

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome, {firstName}</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Here&apos;s what&apos;s happening across your projects.
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Your Projects</h2>
        <Link
          href="/projects/new"
          className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Create Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <p className="text-gray-500 text-sm">No projects yet.</p>
          <Link
            href="/projects/new"
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
          >
            Create your first project →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-sm transition-shadow block"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-medium text-gray-900 text-sm leading-snug">{p.name}</h3>
                <ProjectStatusTag status={p.status} size="sm" className="flex-shrink-0" />
              </div>
              {p.contract_value !== null && (
                <p className="text-sm text-gray-500">
                  ₹{Number(p.contract_value).toLocaleString('en-IN')}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
