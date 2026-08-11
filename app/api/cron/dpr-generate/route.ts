import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { enqueueJob } from '@/lib/queue/jobs'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { istDateString } from '@/lib/daily-logs/date'

// 8:00 PM IST trigger (bot-flows.md TRIGGER TIMES) — enqueues one
// dpr_generate job per eligible project for today's log_date. Does the
// actual Claude call and write inside the job handler
// (lib/dpr/dispatch.ts), never here — NFR-16, ALL Claude API calls run
// through the jobs table, never synchronously in a request handler.
//
// ELIGIBILITY (2026-08-12, Aravind's decision): status='active' only.
// owner_user_id is deliberately NOT a condition here — the DPR is also
// DASH-04's archive artifact, and a project with a PM but no owner still
// wants one generated and archived. Owner presence decides who it's
// DELIVERED to (Phase 5/6's problem), never whether it's MADE. Coupling
// generation to owner presence would silently produce no report at all
// for such a project, with nothing indicating why.
//
// DPR-17 (zero-data day) is checked per project BEFORE enqueueing, not
// left to the job handler — a project with no daily_logs rows for today
// (including one with no engineers assigned at all, which is
// structurally the same state) gets delivery_status='skipped_no_data'
// directly, generator never runs on nothing.

export interface DprGenerateTriggerResult {
  project_id: string
  action: 'skipped_no_data' | 'enqueued' | 'already_queued'
}

/**
 * The real logic, extracted from GET so a test can call it directly with
 * an injected client — same shape as handleWebhookPost (app/api/whatsapp/
 * webhook/route.ts): GET below is a thin wrapper supplying today's
 * production default. logDate is a parameter (not computed inside) so a
 * test can pin it without faking `Date`.
 */
export async function runDprGenerateTrigger(
  client: SupabaseClient,
  logDate: string,
): Promise<DprGenerateTriggerResult[]> {
  const { data: projects, error: projectsError } = await client
    .from('projects')
    .select('id, tenant_id')
    .eq('status', 'active')
  if (projectsError) throw projectsError

  const results: DprGenerateTriggerResult[] = []

  for (const project of projects ?? []) {
    const { data: logs, error: logsError } = await client
      .from('daily_logs')
      .select('id')
      .eq('project_id', project.id)
      .eq('log_date', logDate)
      .limit(1)
    if (logsError) throw logsError

    if (!logs || logs.length === 0) {
      // Zero-data day (DPR-17). Also structurally covers "no engineer
      // assigned at all" — that project could never have a daily_logs row
      // for today either, so no separate roster check is needed.
      const { error: skipError } = await client.from('dprs').upsert(
        {
          project_id: project.id,
          tenant_id: project.tenant_id,
          log_date: logDate,
          delivery_status: 'skipped_no_data',
          generation_status: 'idle',
        },
        { onConflict: 'project_id,log_date' },
      )
      if (skipError) throw skipError
      results.push({ project_id: project.id, action: 'skipped_no_data' })
      continue
    }

    // Dedup — Vercel Cron delivery is best-effort and can invoke the same
    // scheduled run more than once (Vercel's own documented behaviour); an
    // already-pending/running dpr_generate job for this exact (project_id,
    // log_date) must not get a second one queued behind it.
    const { data: existingJobs, error: existingJobsError } = await client
      .from('jobs')
      .select('id')
      .eq('type', 'dpr_generate')
      .in('status', ['pending', 'running'])
      .contains('payload', { project_id: project.id, log_date: logDate })
      .limit(1)
    if (existingJobsError) throw existingJobsError

    if (existingJobs && existingJobs.length > 0) {
      results.push({ project_id: project.id, action: 'already_queued' })
      continue
    }

    await enqueueJob('dpr_generate', { project_id: project.id, log_date: logDate }, client)
    results.push({ project_id: project.id, action: 'enqueued' })
  }

  return results
}

export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const logDate = istDateString(new Date())
  try {
    const results = await runDprGenerateTrigger(createServiceClient(), logDate)
    return NextResponse.json({ log_date: logDate, projects: results.length, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
