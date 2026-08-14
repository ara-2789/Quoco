import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimJobs, completeJob, failJob, type Job } from '@/lib/queue/jobs'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { handleDprGenerateJob, markDprGenerationFailed, type DprGenerateJobPayload } from '@/lib/dpr/dispatch'
import { createServiceClient } from '@/lib/supabase/service'

// This endpoint is polled by Vercel Cron every 60 seconds (NFR-16).
// It claims up to 3 pending/retry-due jobs and processes each one.
// Handlers for real job types (owner_deliver, etc.) get added to the
// dispatch map below as those features are built.

async function dispatchJob(job: Job, client: SupabaseClient): Promise<void> {
  switch (job.type) {
    case 'dpr_generate':
      await handleDprGenerateJob(job.payload as unknown as DprGenerateJobPayload, job.id, { supabaseClient: client })
      return
    // Placeholder handler — proves the claim/complete/fail loop works
    // end-to-end before these job types exist. Remove entries as their
    // real handlers are wired up.
    case 'owner_deliver':
    case 'template_send':
    case 'morning_trigger':
    case 'evening_trigger':
    case 'nudge':
      throw new Error(`No handler implemented yet for job type: ${job.type}`)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}

/**
 * The real logic, extracted from GET so a test can call it directly with an
 * injected client — same shape as handleWebhookPost/runDprGenerateTrigger.
 */
export async function runJobsTick(client: SupabaseClient) {
  const jobs = await claimJobs(3, client)

  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        await dispatchJob(job, client)
        await completeJob(job.id, client)
        return { id: job.id, status: 'succeeded' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const { willRetry } = await failJob(job.id, message, client)
        // NFR-17 dead-letter mapping, dpr_generate only, ONLY once
        // retries are truly exhausted — see markDprGenerationFailed's own
        // comment (lib/dpr/dispatch.ts) for why this lives here, not
        // inside the handler, and not inside lib/queue/jobs.ts.
        if (!willRetry && job.type === 'dpr_generate') {
          const payload = job.payload as unknown as DprGenerateJobPayload
          await markDprGenerationFailed(client, payload.project_id, payload.engineer_id, payload.log_date)
        }
        return { id: job.id, status: 'failed', willRetry, error: message }
      }
    }),
  )

  return {
    claimed: jobs.length,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
  }
}

export async function GET(request: NextRequest) {
  // AUTH (2026-08-12) — this route previously had none, live in
  // production; see lib/cron/auth.ts for the incident this closes and why
  // it's the same class as migration 020.
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runJobsTick(createServiceClient())
  return NextResponse.json(result)
}
