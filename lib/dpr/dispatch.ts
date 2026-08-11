import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import { assembleDprFacts } from './assemble'
import { assembleAccountability } from './accountability'
import { fetchNarrativeContext } from './narrative-context'
import { generateDprJudgment, DprValidationError } from './generate'
import { renderDpr } from './render'

// The dpr_generate job handler (Phase 3, 2026-08-12) — wires the sequence
// scripts/generate-one-dpr.ts already proved by hand (assembleDprFacts ->
// fetchNarrativeContext -> assembleAccountability -> generateDprJudgment ->
// renderDpr -> upsert dprs) into a real job handler, called from
// app/api/jobs/tick/route.ts's dispatchJob.

export interface DprGenerateJobPayload {
  project_id: string
  log_date: string
}

// generation_status / delivery_status are ORTHOGONAL lifecycles (023's own
// table comment, docs/schema.md) — this file is careful never to couple
// their transitions. generation_status only ever reflects THIS handler's
// own compute-job progress ('running' while it's actively executing,
// 'idle' once it's done, whichever way it ends). delivery_status is
// touched ONLY by markDprGenerationFailed, below, and ONLY once retries
// are truly exhausted — never by this function on an intermediate,
// still-retryable failure.
export async function handleDprGenerateJob(
  payload: DprGenerateJobPayload,
  jobId: string,
  deps: { supabaseClient?: SupabaseClient; anthropicClient?: Anthropic } = {},
): Promise<void> {
  const client = deps.supabaseClient ?? createServiceClient()
  const anthropic = deps.anthropicClient ?? new Anthropic()

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('name, tenant_id')
    .eq('id', payload.project_id)
    .single()
  if (projectError) throw projectError

  // Claim the row BEFORE the Claude call — generation_claimed_at
  // (migration 026, not yet shipped — see CLAUDE.md §10) will be added
  // here once that migration ships with a real, measured stale-sweep
  // interval; omitted for now rather than guessed at.
  const { error: claimError } = await client.from('dprs').upsert(
    {
      project_id: payload.project_id,
      tenant_id: project.tenant_id,
      log_date: payload.log_date,
      generation_status: 'running',
      generator_job_id: jobId,
    },
    { onConflict: 'project_id,log_date' },
  )
  if (claimError) throw claimError

  // END-TO-END TIMING INSTRUMENTATION (2026-08-12) — the cheapest thing
  // that works, per the same reasoning as the validation-failure Sentry
  // signal below: a structured log line, not a new table, aggregable from
  // Vercel's log export. This is the measurement migration 026's stale-
  // sweep interval is waiting on: the model-call-only latency figures
  // measured earlier this project (6-11s) were the WRONG base for that
  // constant — they never included assembleDprFacts, fetchNarrativeContext,
  // assembleAccountability, render, or the write. This timing covers the
  // whole handler, per real project-day, so that constant can finally be
  // derived from the right number instead of an estimate.
  const timings: Record<string, number> = {}
  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      return await fn()
    } finally {
      timings[label] = Date.now() - start
    }
  }

  const totalStart = Date.now()
  try {
    const facts = await timed('assembleDprFacts', () => assembleDprFacts(client, payload.project_id, payload.log_date))
    const narrative = await timed('fetchNarrativeContext', () =>
      fetchNarrativeContext(client, payload.project_id, payload.log_date),
    )
    const accountability = await timed('assembleAccountability', () =>
      assembleAccountability(client, payload.project_id, payload.log_date),
    )
    const result = await timed('generateDprJudgment', () =>
      generateDprJudgment(anthropic, facts, narrative, { project_name: project.name, log_date: payload.log_date }),
    )
    const { structured, content } = renderDpr(facts, result.judgment, accountability)

    await timed('dprsUpsert', async () => {
      const { error } = await client.from('dprs').upsert(
        {
          project_id: payload.project_id,
          tenant_id: project.tenant_id,
          log_date: payload.log_date,
          structured: structured as unknown as Json,
          content,
          generated_at: new Date().toISOString(),
          generation_status: 'idle',
        },
        { onConflict: 'project_id,log_date' },
      )
      if (error) throw error
    })

    console.log(
      JSON.stringify({
        event: 'dpr_generate_timing',
        project_id: payload.project_id,
        log_date: payload.log_date,
        steps_ms: timings,
        total_ms: Date.now() - totalStart,
      }),
    )
  } catch (err) {
    // Revert BEFORE rethrow — the row must never stick at 'running' on a
    // failure the outer failJob (route.ts) is about to record and
    // possibly retry. This is a NORMAL, TIMELY failure path; it is not
    // the process-died-mid-call case migration 026's stale sweep exists
    // for (that case, by definition, never reaches this catch at all).
    await client
      .from('dprs')
      .update({ generation_status: 'idle' })
      .eq('project_id', payload.project_id)
      .eq('log_date', payload.log_date)

    if (err instanceof DprValidationError) {
      // COUNTABLE, ON EVERY OCCURRENCE — not only once retries exhaust.
      // A containment/no-digit violation is stochastic; a fresh retry may
      // well pass, and a successful retry must not make this invisible —
      // if the rate rises, that's a signal the prompt or corpus rules
      // need work, and it has to be counted even when attempt 2 succeeds.
      // Separate from, and in addition to, the exhaustion-triggered
      // NFR-17 alert below (markDprGenerationFailed), which only fires
      // once retries truly run out.
      Sentry.captureException(err, {
        tags: { feature: 'dpr-generate', failure_class: 'dpr_validation' },
        extra: { project_id: payload.project_id, log_date: payload.log_date, violations: err.violations },
      })
    }
    throw err
  }
}

// Called from app/api/jobs/tick/route.ts ONLY after failJob reports
// willRetry: false for a dpr_generate job — i.e., only once retries are
// truly exhausted (NFR-17). generation_status's CHECK constraint (idle/
// pending/running/stale) has no 'failed' value; a permanent failure can
// only be expressed through delivery_status, and only here, in exactly
// this one place — kept out of handleDprGenerateJob itself, which cannot
// know at throw-time whether ITS failure is the final attempt (that's
// decided by failJob, one layer up, after this function has already
// thrown). Keeping lib/queue/jobs.ts itself job-type-agnostic.
export async function markDprGenerationFailed(
  client: SupabaseClient,
  project_id: string,
  log_date: string,
): Promise<void> {
  const { error } = await client
    .from('dprs')
    .update({ delivery_status: 'failed', generation_status: 'idle' })
    .eq('project_id', project_id)
    .eq('log_date', log_date)
  if (error) throw error
}
