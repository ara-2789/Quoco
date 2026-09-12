// Hand-invoked DPR generator — the smallest slice that produces one real,
// model-generated per-engineer DPR (docs/dpr-engineer-report-spec.md),
// provable by reading the row back. Deliberately bypasses the jobs queue,
// cron, and delivery entirely — same scope discipline as the original
// project-level version of this script (2026-08-11).
// Run: npx tsx scripts/generate-one-dpr.ts <project_id> <engineer_id> <log_date>
//
// REWRITTEN 2026-08-14 (round-4 B2 finding, docs/reviews/028-dpr-engineer-
// report-review-package.md §9): the old version called the project-level
// pipeline (assembleDprFacts/generateDprJudgment/renderDpr) and upserted
// with onConflict:'project_id,log_date' — a key shape migration 028
// retires entirely (every dprs row now requires engineer_id). A
// project-level "one row per project-day" script cannot cleanly map onto
// that schema, so this is a genuine rewrite against the new per-engineer
// pipeline, not a patched call shape. The old project-level functions this
// script used to call are UNCHANGED and still exist for the deferred
// project-level report — just no longer called from here.
//
// MUST NOT RUN between a migration-028 apply and its deploy landing — see
// the review package's B3-amend section for why (this script is the
// second writer B3-amend's runbook names explicitly).

import { config } from 'dotenv'
config({ path: '.env.local' })

import Anthropic from '@anthropic-ai/sdk'
import type { Json } from '../types/database'
import { createServiceClient } from '../lib/supabase/service'
import { assembleEngineerDprFacts } from '../lib/dpr/assemble'
import { fetchEngineerNarrativeContext } from '../lib/dpr/narrative-context'
import { generateEngineerVerdict } from '../lib/dpr/generate'
import { renderEngineerReport, CONTAINMENT_FAILURE_PLACEHOLDER } from '../lib/dpr/render'
import { resolveProjectManagerName } from '../lib/dpr/project-manager'
import { correctEngineerWorkText } from '../lib/dpr/spelling-correction'
import { writeDprVersion } from '../lib/dpr/write-version'

async function main() {
  const [projectId, engineerId, logDate] = process.argv.slice(2)
  if (!projectId || !engineerId || !logDate) {
    console.error('Usage: npx tsx scripts/generate-one-dpr.ts <project_id> <engineer_id> <log_date YYYY-MM-DD>')
    process.exit(1)
  }

  const client = createServiceClient()
  const anthropic = new Anthropic()

  const { data: project, error: projectError } = await client.from('projects').select('name, tenant_id').eq('id', projectId).single()
  if (projectError) throw projectError

  const { data: engineer, error: engineerError } = await client.from('users').select('full_name').eq('id', engineerId).single()
  if (engineerError) throw engineerError

  console.log(`Assembling Facts for project ${projectId} (${project.name}), engineer ${engineerId}, ${logDate}...`)
  const assembled = await assembleEngineerDprFacts(client, projectId, engineerId, logDate)
  const { completeness } = assembled
  let facts = assembled.facts
  const narrative = await fetchEngineerNarrativeContext(client, projectId, engineerId, logDate)

  console.log('Correcting WORK spelling...')
  const workCorrection = await correctEngineerWorkText(anthropic, facts.work.planned, facts.work.done_text)
  facts = { ...facts, work: { ...facts.work, planned_corrected: workCorrection.planned, done_text_corrected: workCorrection.done_text } }

  console.log('Calling Claude...')
  const result = await generateEngineerVerdict(anthropic, facts, narrative, { project_name: project.name, log_date: logDate })
  // 'judgment_denylist' (2026-09-11) collapses into the same placeholder
  // treatment as a containment failure HERE ONLY -- this script never
  // calls resolveCheckInStatus (a pre-existing limitation, unrelated to
  // this change), so it has no morning/evening classification to build
  // the real codeTemplatedVerdict fallback dispatch.ts now uses. Fine for
  // a hand-invoked debug script; not the production path.
  const verdict = result.verdict_status !== 'model' ? CONTAINMENT_FAILURE_PLACEHOLDER : result.verdict
  const verdictStatus = result.verdict_status === 'model' ? 'model' : 'placeholder'
  const projectManagerName = await resolveProjectManagerName(client, projectId)

  const rendered = renderEngineerReport(
    facts,
    verdict,
    verdictStatus,
    { status: completeness.morning },
    { status: completeness.evening },
    {
      project_name: project.name,
      engineer_name: (engineer.full_name as string | null) ?? 'Unnamed engineer',
      formatted_date: new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }),
      project_manager_name: projectManagerName,
    },
  )

  // Part A (docs/plans/dpr-owner-pass-regeneration.md) — same write path
  // as dispatch.ts now uses: write_dpr_version instead of a raw upsert, so
  // a hand-re-run of this script against an already-generated day appends
  // a version instead of silently overwriting it with no history. No
  // dprId known here (this script has no earlier claim step of its own),
  // so writeDprVersion ensures the row via its own shell upsert.
  await writeDprVersion({
    client,
    projectId,
    engineerId,
    tenantId: project.tenant_id as string,
    logDate,
    content: rendered.content,
    structured: rendered.structured as unknown as Json,
  })

  console.log('\n=== USAGE / COST ===')
  console.log(`Input tokens:  ${result.usage.input_tokens}`)
  console.log(`Output tokens: ${result.usage.output_tokens}`)
  console.log(`Latency:       ${result.latency_ms}ms`)
  console.log(`Attempts:      ${result.attempts}`)
  console.log(`Cost (USD):    $${result.cost_usd.toFixed(6)}`)

  console.log('\n=== RENDERED CONTENT ===')
  console.log(rendered.content)

  console.log('\nWritten to dprs.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
