// READ-ONLY DPR preview -- prints the real rendered report(s) for a
// project + log_date, including a real model call for the narrative, with
// ZERO writes: no dprs upsert, no delivery_status change, no
// outbound_sends row, no job enqueue. Built for repeated ad-hoc review of
// how a real day's data actually renders, without sending an owner
// anything -- scripts/generate-one-dpr.ts is the write-capable sibling
// (upserts `dprs`); this script exists because that one is not safe to
// run against a real, already-live date on a whim.
//
// Run: npx tsx scripts/preview-dpr.ts <project_id> <log_date YYYY-MM-DD>
//
// Engineer resolution matches the real trigger's own logic exactly
// (app/api/cron/dpr-generate/route.ts SET 1 + SET 2), not a script-local
// guess: active roster (project_members JOIN users, role='engineer',
// status='active') UNION every engineer with a real daily_logs row for
// this date (S3, real-data-wins) -- so this script previews the same set
// of reports the real cron would actually generate, not a different set.
//
// THE WRITE GUARD is not just "this script doesn't call .insert/.upsert
// anywhere" (true, but that alone is a claim about the code, not an
// enforced property). readOnlyClient() below wraps the real Supabase
// client so that .insert/.upsert/.update/.delete/.upsert on ANY table
// throws immediately, before the request ever reaches the network --
// enforced at the client boundary, not merely absent from this file's own
// call sites. If a future edit to this script (or a library change) ever
// introduces a write path, it fails loudly here instead of silently
// writing to production.

import { config } from 'dotenv'
config({ path: '.env.local' })

import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { assembleEngineerDprFacts } from '../lib/dpr/assemble'
import { fetchEngineerNarrativeContext } from '../lib/dpr/narrative-context'
import { generateEngineerVerdict } from '../lib/dpr/generate'
import { renderEngineerReport, CONTAINMENT_FAILURE_PLACEHOLDER } from '../lib/dpr/render'

const WRITE_METHODS = ['insert', 'upsert', 'update', 'delete', 'rpc'] as const

function readOnlyClient(): SupabaseClient<Database> {
  const real = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        return () => {
          throw new Error('preview-dpr.ts is read-only: rpc() calls are blocked (could be a write). This script must never call one.')
        }
      }
      if (prop === 'from') {
        return (table: string) => {
          const builder = (target.from as (t: string) => ReturnType<SupabaseClient['from']>)(table)
          return new Proxy(builder, {
            get(builderTarget, builderProp, builderReceiver) {
              if (WRITE_METHODS.includes(builderProp as (typeof WRITE_METHODS)[number])) {
                return () => {
                  throw new Error(
                    `preview-dpr.ts is read-only: .${String(builderProp)}() blocked on table "${table}". ` +
                      'This script must never write. If this is a genuine new requirement, it belongs in a ' +
                      'different, explicitly write-capable script (like scripts/generate-one-dpr.ts), not here.',
                  )
                }
              }
              return Reflect.get(builderTarget, builderProp, builderReceiver)
            },
          })
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as SupabaseClient<Database>
}

async function main() {
  const [projectId, logDate] = process.argv.slice(2)
  if (!projectId || !logDate) {
    console.error('Usage: npx tsx scripts/preview-dpr.ts <project_id> <log_date YYYY-MM-DD>')
    process.exit(1)
  }

  const client = readOnlyClient()
  const anthropic = new Anthropic()

  const { data: project, error: projectError } = await client.from('projects').select('name, tenant_id').eq('id', projectId).single()
  if (projectError) throw projectError

  // SET 1 -- active roster, same query shape as app/api/cron/dpr-generate/route.ts.
  const { data: members, error: membersError } = await client
    .from('project_members')
    .select('users!inner(id, role, status)')
    .eq('project_id', projectId)
    .eq('users.role', 'engineer')
    .eq('users.status', 'active')
  if (membersError) throw membersError

  const rosterIds = (members ?? [])
    .map((m) => {
      const users = (m as { users: unknown }).users
      const row = Array.isArray(users) ? users[0] : users
      return (row as { id?: string } | null)?.id
    })
    .filter((id): id is string => typeof id === 'string')

  // SET 2 -- real data, regardless of current roster membership (S3).
  const { data: logs, error: logsError } = await client.from('daily_logs').select('engineer_id').eq('project_id', projectId).eq('log_date', logDate)
  if (logsError) throw logsError
  const loggedIds = (logs ?? []).map((l) => l.engineer_id as string)

  const engineerIds = Array.from(new Set([...rosterIds, ...loggedIds]))
  if (engineerIds.length === 0) {
    console.log(`No engineers found for project ${projectId} (${project.name}) on ${logDate} -- no roster membership, no daily_logs row.`)
    return
  }

  console.log(`Project ${projectId} (${project.name}), ${logDate} -- ${engineerIds.length} engineer(s):\n`)

  for (const engineerId of engineerIds) {
    const { data: engineer, error: engineerError } = await client.from('users').select('full_name').eq('id', engineerId).single()
    if (engineerError) throw engineerError

    console.log('='.repeat(72))
    console.log(`Engineer ${engineerId} (${engineer.full_name ?? 'Unnamed engineer'})`)
    console.log('='.repeat(72))

    const { facts, completeness } = await assembleEngineerDprFacts(client, projectId, engineerId, logDate)
    const narrative = await fetchEngineerNarrativeContext(client, projectId, engineerId, logDate)

    console.log('\n--- Calling Claude for the real narrative ---')
    const result = await generateEngineerVerdict(anthropic, facts, narrative, { project_name: project.name, log_date: logDate })
    const verdict = result.verdict_status === 'placeholder' ? CONTAINMENT_FAILURE_PLACEHOLDER : result.verdict

    const rendered = renderEngineerReport(
      facts,
      verdict,
      result.verdict_status,
      { status: completeness.morning },
      { status: completeness.evening },
      {
        project_name: project.name,
        engineer_name: (engineer.full_name as string | null) ?? 'Unnamed engineer',
        formatted_date: new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }),
      },
    )

    console.log(`\nUsage: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out, $${result.cost_usd.toFixed(6)}, ${result.latency_ms}ms, ${result.attempts} attempt(s)`)
    console.log('\n--- RENDERED CONTENT ---\n')
    console.log(rendered.content)
    console.log('')
  }

  console.log('Nothing written -- read-only preview only.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
