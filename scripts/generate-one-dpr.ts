// Hand-invoked DPR generator — the smallest slice that produces one real,
// model-generated DPR for one project-day, provable by reading the row
// back. Deliberately bypasses the jobs queue, cron, DPR-23's concurrent-
// regen claim, and delivery entirely — none of those exist yet
// (CLAUDE.md §10). Run: npx tsx scripts/generate-one-dpr.ts <project_id> <log_date>
//
// Prints input tokens, output tokens, wall-clock latency, and computed cost
// per run (Addition 1 of the 2026-08-11 DPR generator slice) — the cheapest
// moment to establish real per-project-per-day generation cost.

import { config } from 'dotenv'
config({ path: '.env.local' })

import type { Json } from '../types/database'
import { createServiceClient } from '../lib/supabase/service'
import { assembleDprFacts } from '../lib/dpr/assemble'
import { assembleAccountability } from '../lib/dpr/accountability'
import { fetchNarrativeContext } from '../lib/dpr/narrative-context'
import { generateDprJudgment, ContainmentViolationError } from '../lib/dpr/generate'
import { renderDpr } from '../lib/dpr/render'

async function main() {
  const [projectId, logDate] = process.argv.slice(2)
  if (!projectId || !logDate) {
    console.error('Usage: npx tsx scripts/generate-one-dpr.ts <project_id> <log_date YYYY-MM-DD>')
    process.exit(1)
  }

  const client = createServiceClient()

  const { data: project, error: projectError } = await client.from('projects').select('name, tenant_id').eq('id', projectId).single()
  if (projectError) throw projectError

  console.log(`Assembling Facts for project ${projectId} (${project.name}), ${logDate}...`)
  const facts = await assembleDprFacts(client, projectId, logDate)
  const narrative = await fetchNarrativeContext(client, projectId, logDate)
  const accountability = await assembleAccountability(client, projectId, logDate)

  console.log('Calling Claude...')
  let result
  try {
    result = await generateDprJudgment(facts, narrative, { project_name: project.name, log_date: logDate })
  } catch (err) {
    if (err instanceof ContainmentViolationError) {
      console.error(`CONTAINMENT VIOLATION — no row written. ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  const { structured, content } = renderDpr(facts, result.judgment, accountability)

  const { error: upsertError } = await client
    .from('dprs')
    .upsert(
      {
        project_id: projectId,
        tenant_id: project.tenant_id,
        log_date: logDate,
        structured: structured as unknown as Json,
        content,
        generated_at: new Date().toISOString(),
        generation_status: 'idle',
      },
      { onConflict: 'project_id,log_date' },
    )
  if (upsertError) throw upsertError

  console.log('\n=== USAGE / COST ===')
  console.log(`Input tokens:  ${result.usage.input_tokens}`)
  console.log(`Output tokens: ${result.usage.output_tokens}`)
  console.log(`Latency:       ${result.latency_ms}ms`)
  console.log(`Cost (USD):    $${result.cost_usd.toFixed(6)}`)

  console.log('\n=== RENDERED CONTENT ===')
  console.log(content)

  console.log('\nWritten to dprs.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
