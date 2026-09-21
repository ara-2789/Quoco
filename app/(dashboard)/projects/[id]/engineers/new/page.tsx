import Link from 'next/link'
import { getProfile } from '@/lib/auth/profile'
import { createClient } from '@/lib/supabase/server'
import { checkEngineerAdminAccess } from '@/lib/engineers/gate'
import * as copy from '@/lib/engineers/copy'
import { AddEngineersForm } from './add-engineers-form'

// Add-engineer slice 1, PR A: the add screen. The gate runs BEFORE anything is
// rendered and before any engineer row is read (this page reads none); it is
// advisory -- add_engineers_to_project re-runs the authoritative SQL gate on
// every call (docs/plans/add-engineer-plan.md section 1).
//
// The check goes through the caller's OWN client (never the service role), so a
// project in another company is invisible under RLS and answers exactly like a
// project that does not exist: copy.errors.projectNotFound, nothing else.
export default async function AddEngineersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getProfile() // enforces auth -- redirects to /login if unauthenticated
  const supabase = await createClient()
  const { verdict, projectName } = await checkEngineerAdminAccess(supabase, profile, id)

  // Back navigation is the project's name (data) with the existing "←" pattern
  // from projects/[id]/page.tsx -- no string of its own (decision D-A6).
  const back =
    projectName !== null ? (
      <div className="mb-2">
        <Link href={`/projects/${id}`} className="text-sm text-gray-700 hover:text-gray-700">
          ← {projectName}
        </Link>
      </div>
    ) : null

  if (verdict !== 'allow') {
    return (
      <div className="p-8 max-w-3xl">
        {back}
        <p role="alert" className="text-sm text-gray-900">
          {verdict === 'not_found' ? copy.errors.projectNotFound : copy.errors.notAllowed}
        </p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      {back}
      <h1 className="text-2xl font-semibold text-gray-900">{copy.page.title}</h1>
      <p className="text-gray-700 text-sm mt-1">{copy.page.intro}</p>
      <p className="text-gray-700 text-sm mt-1 mb-6">{copy.page.formatHelp}</p>
      <AddEngineersForm projectId={id} />
    </div>
  )
}
