// Ad-hoc menu PR 2, step 5 -- pre-merge gate for PR #241 (item 1 wiring),
// Aravind's own explicit question: does resolveProjectPMEmails (lib/
// hindrance/pm-notify.ts) actually resolve a real PM email for every real
// project on prod, TODAY, via the real code path -- not a SQL
// approximation of it. A read-only SQL join (auth.users LEFT JOIN) already
// confirmed every project has exactly one PM with a non-deleted,
// non-banned auth.users row and a present email -- but that is not the
// same claim as "the Admin API call this function actually makes returns
// the same thing." This script runs the real function.
//
// MUST BE RUN BY A HUMAN, WITH REAL CREDENTIALS -- this sandbox has none
// (confirmed: no .env.local, no SUPABASE_SERVICE_ROLE_KEY/
// NEXT_PUBLIC_SUPABASE_URL in this shell). Same pattern as
// scripts/verify-email-delivery.ts's own header.
//
// READ-ONLY -- resolveProjectPMEmails only SELECTs (project_members,
// auth.admin.getUserById); it writes nothing. Safe to run against
// production directly.
//
// Run: npx tsx scripts/verify-pm-resolvability.ts
// (no argument -- iterates every real project on prod itself, via the
// same service-role client the real handler uses, so there is no risk of
// a typo'd project_id silently checking the wrong thing.)
//
// Emails are MASKED in the printed output (local-part redacted, domain
// shown) -- this only needs to answer "does a real address resolve," not
// put a real PM's full email into whatever channel reads this script's
// stdout. Full targets (userId, fullName, masked email) are printed so a
// gap is fully diagnosable without needing the raw address.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createServiceClient } from '../lib/supabase/service'
import { resolveProjectPMEmails } from '../lib/hindrance/pm-notify'

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '(unparseable)'
  return `${email[0]}***@${email.slice(at + 1)}`
}

async function main() {
  const supabase = createServiceClient()

  // Breadcrumb FIRST, same discipline as every other prod-touching script
  // this project runs -- current_database() alone is useless (always
  // "postgres"), so pair it with real content.
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(5)
  if (tenantsError) {
    console.error('Breadcrumb check failed -- refusing to proceed without confirming target:', tenantsError.message)
    process.exit(1)
  }
  console.log('Breadcrumb -- real tenant names on the connected project:')
  for (const t of tenants ?? []) console.log(`  ${t.name}`)
  console.log('Confirm this is production before trusting anything below.\n')

  const { data: projects, error: projectsError } = await supabase.from('projects').select('id, name').order('name')
  if (projectsError) {
    console.error('Failed to list projects:', projectsError.message)
    process.exit(1)
  }
  if (!projects || projects.length === 0) {
    console.error('No projects found at all -- nothing to check.')
    process.exit(1)
  }

  console.log(`Checking ${projects.length} real project(s) via the ACTUAL resolveProjectPMEmails path:\n`)

  let anyZero = false
  for (const project of projects) {
    const result = await resolveProjectPMEmails(project.id, supabase)
    if (result.outcome === 'zero_pms') {
      anyZero = true
      console.log(`✗ ${project.name} (${project.id}): ZERO_PMS -- no resolvable PM email. A hindrance report on this project would say "Your Project Manager will see it" and nobody would.`)
      continue
    }
    console.log(`✓ ${project.name} (${project.id}): ${result.targets.length} PM(s) resolved:`)
    for (const t of result.targets) {
      console.log(`    userId=${t.userId} fullName=${t.fullName ?? '(none)'} email=${maskEmail(t.email)}`)
    }
  }

  console.log('')
  if (anyZero) {
    console.error('AT LEAST ONE PROJECT HAS NO RESOLVABLE PM. Do not merge PR #241 until this is resolved or a decision is made about the confirmation copy.')
    process.exit(1)
  }
  console.log('Every real project resolves at least one real PM email via the actual code path.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
