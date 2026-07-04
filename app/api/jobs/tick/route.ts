import { NextResponse } from 'next/server'
import { claimJobs, completeJob, failJob, type Job } from '@/lib/queue/jobs'

// This endpoint is polled by Vercel Cron every 60 seconds (NFR-16).
// It claims up to 3 pending/retry-due jobs and processes each one.
// Handlers for real job types (dpr_generate, owner_deliver, etc.) get
// added to the dispatch map below as those features are built.

async function dispatchJob(job: Job): Promise<void> {
  switch (job.type) {
    // Placeholder handler — proves the claim/complete/fail loop works
    // end-to-end before any real job types exist. Remove once the first
    // real handler (dpr_generate) is wired up.
    case 'dpr_generate':
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

export async function GET() {
  const jobs = await claimJobs(3)

  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        await dispatchJob(job)
        await completeJob(job.id)
        return { id: job.id, status: 'succeeded' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const { willRetry } = await failJob(job.id, message)
        return { id: job.id, status: 'failed', willRetry, error: message }
      }
    }),
  )

  return NextResponse.json({
    claimed: jobs.length,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
  })
}