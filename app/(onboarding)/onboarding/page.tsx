import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

async function createCompany(formData: FormData) {
  'use server'
  const companyName = (formData.get('company_name') as string).trim()
  const fullName = (formData.get('full_name') as string).trim()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { error } = await supabase.rpc('complete_onboarding', {
    p_company_name: companyName,
    p_slug: slugify(companyName),
    p_full_name: fullName,
  })

  if (error) {
    const msg = error.message.includes('unique')
      ? 'A company with that name already exists. Please try a different name.'
      : error.message
    redirect(`/onboarding?error=${encodeURIComponent(msg)}`)
  }

  redirect('/dashboard')
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Create your company</h2>
      <p className="text-gray-500 text-sm mb-6">
        This sets up your workspace. You can add team members after.
      </p>

      {params.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {params.error}
        </div>
      )}

      <form action={createCompany} className="space-y-4">
        <div>
          <label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
            Company name
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            required
            placeholder="Rajamani Constructions Pvt Ltd"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">Used as your workspace name and URL slug.</p>
        </div>
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-1">
            Your name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            placeholder="Aravindan Rajamani"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Create workspace
        </button>
      </form>
    </div>
  )
}
