import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'

async function createProject(formData: FormData) {
  'use server'
  const supabase = await createClient()
  // getProfile() gates auth and fail-louds on a missing profile. profile.id
  // (the decoupled users.id, NOT the auth uid) is the FK value written into
  // created_by / project_members.user_id below.
  const profile = await getProfile()

  // getProfile() guarantees a profile exists, but the generated type marks
  // users.tenant_id nullable (engineer/owner rows can be pre-tenant). A PM
  // creating a project is always tenant-scoped, so a null here is a broken
  // invariant — fail loud rather than write a null tenant_id via a `!` assert.
  if (!profile.tenant_id) {
    throw new Error(
      `createProject: profile ${profile.id} has no tenant_id — cannot create a project`,
    )
  }

  const name = (formData.get('name') as string).trim()
  const contractValueRaw = (formData.get('contract_value') as string).trim()
  const startDate = (formData.get('start_date') as string).trim() || null
  const endDate = (formData.get('expected_end_date') as string).trim() || null
  const contractValue = contractValueRaw ? parseFloat(contractValueRaw) : null

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      tenant_id: profile.tenant_id,
      name,
      contract_value: contractValue,
      start_date: startDate,
      expected_end_date: endDate,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !project) {
    redirect(
      `/projects/new?error=${encodeURIComponent(error?.message ?? 'Failed to create project')}`,
    )
  }

  const { error: memberError } = await supabase.from('project_members').insert({
    tenant_id: profile.tenant_id,
    project_id: project.id,
    user_id: profile.id,
    role: 'pm',
  })

  if (memberError) {
    redirect(`/projects/new?error=${encodeURIComponent(memberError.message)}`)
  }

  redirect('/projects')
}

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <div className="p-8 max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Project</h1>
        <p className="text-gray-500 text-sm mt-1">Create a new construction project.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        {params.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {params.error}
          </div>
        )}

        <form action={createProject} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="NH-48 Bridge Widening — Package 3"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="contract_value"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Contract Value (₹)
            </label>
            <input
              id="contract_value"
              name="contract_value"
              type="number"
              min="0"
              step="0.01"
              placeholder="25000000"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                id="start_date"
                name="start_date"
                type="date"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label
                htmlFor="expected_end_date"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Expected End Date
              </label>
              <input
                id="expected_end_date"
                name="expected_end_date"
                type="date"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              className="bg-blue-600 text-white rounded-md px-5 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
            >
              Create Project
            </button>
            <a
              href="/projects"
              className="bg-white border border-gray-300 text-gray-700 rounded-md px-5 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
