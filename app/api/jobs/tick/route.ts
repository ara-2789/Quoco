import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimJobs, completeJob, failJob, type Job } from '@/lib/queue/jobs'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { handleDprGenerateJob, markDprGenerationFailed, type DprGenerateJobPayload } from '@/lib/dpr/dispatch'
import { handleOwnerDeliverJob, type OwnerDeliverJobPayload } from '@/lib/dpr/owner-deliver-dispatch'
import { handleHindrancePmNotifyJob, type HindrancePmNotifyJobPayload } from '@/lib/hindrance/pm-notify'
import { handleMediaIngestJob, markMediaIngestFailed, type MediaIngestJobPayload } from '@/lib/media/ingest'
import {
  handleHindranceMediaIngestJob,
  markHindranceMediaIngestFailed,
  type HindranceMediaIngestJobPayload,
} from '@/lib/media/hindrance-ingest'
import {
  sweepStaleMorningSessions,
  reportMorningSweepAnomalies,
  reportMorningSweepError,
  type MorningCutoffSweepResult,
} from '@/lib/daily-logs/morning-cutoff-sweep'
import {
  runOutboundCoverageSweep,
  reportOutboundCoverageAnomalies,
  reportOutboundCoverageSweepError,
  type CoverageSweepResult,
} from '@/lib/whatsapp/outbound/coverage-sweep'
import {
  runCheckinEscalationTickSweep,
  reportCheckinEscalationSweepAnomalies,
  reportCheckinEscalationSweepError,
  type CheckinEscalationSweepResult,
} from '@/lib/checkin-escalations/sweep'
import { createServiceClient } from '@/lib/supabase/service'

// This endpoint is polled by Vercel Cron every 60 seconds (NFR-16).
// It claims up to 3 pending/retry-due jobs and processes each one.
// Handlers for real job types get added to the dispatch map below as those
// features are built. owner_deliver's own handler is built (2026-09-02),
// application code only -- nothing enqueues it yet.

async function dispatchJob(job: Job, client: SupabaseClient): Promise<void> {
  switch (job.type) {
    case 'dpr_generate':
      await handleDprGenerateJob(job.payload as unknown as DprGenerateJobPayload, job.id, { supabaseClient: client })
      return
    case 'owner_deliver':
      // Nothing enqueues this job type yet (no eveningClose/ownerSend cron
      // entry exists) -- see lib/dpr/owner-deliver-dispatch.ts's own header
      // for what else must exist before this handler reaches a real owner.
      await handleOwnerDeliverJob(job.payload as unknown as OwnerDeliverJobPayload, { supabaseClient: client })
      return
    case 'hindrance_pm_notify':
      // Ad-hoc menu PR 2, step 5 -- see lib/hindrance/pm-notify.ts's own
      // header for what else must exist (migration 038 applied, the
      // router wired to the real flow) before this ever reaches a real
      // PM. Enqueued today only by applyHindranceFlowTurn, which nothing
      // in production calls yet.
      await handleHindrancePmNotifyJob(job.payload as unknown as HindrancePmNotifyJobPayload, { supabaseClient: client })
      return
    case 'media_ingest':
      // Stage 1 of the media capability (docs/plans/stage1-photo-intake-
      // plan.md) -- see lib/media/ingest.ts's own header for the full
      // failure-surface note: no PM-visible display exists yet (stage 5),
      // this handler's own failure path (Sentry + a failed status column)
      // is the entire interim surface.
      await handleMediaIngestJob(job.payload as unknown as MediaIngestJobPayload, { supabaseClient: client })
      return
    case 'hindrance_media_ingest':
      // Stage 2 of the media capability (docs/plans/stage2-hindrance-
      // photos-plan.md) -- see lib/media/hindrance-ingest.ts's own header.
      // A sibling of media_ingest, not a branch inside it.
      await handleHindranceMediaIngestJob(job.payload as unknown as HindranceMediaIngestJobPayload, {
        supabaseClient: client,
      })
      return
    // Placeholder handler — proves the claim/complete/fail loop works
    // end-to-end before these job types exist. Remove entries as their
    // real handlers are wired up.
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
  // B3 -- the 15:00 IST morning cutoff sweep (docs/reviews/morning-flow-
  // migration-review-package.md §4). Runs every tick, alongside job
  // claiming below, not as a queued job type -- it's time-triggered, not
  // queued, and the RPC itself gates on the cutoff and is idempotent (see
  // sweep_stale_morning_sessions's own header). Isolated in its own
  // try/catch, same reasoning as each job's own isolation below: a sweep
  // failure must not prevent job claiming/processing from running this
  // tick, but must not be silently swallowed either -- reportMorningSweepError
  // (B2, external review round 1) is what keeps it from being swallowed;
  // "must not fail the tick" is not the same claim as "must not be silent."
  let morningSweep: MorningCutoffSweepResult | { error: string }
  try {
    morningSweep = await sweepStaleMorningSessions(client)
    // B2 -- the skip/missing-row safety argument is load-bearing on this
    // actually running, not merely on the values existing in the return
    // object. See reportMorningSweepAnomalies's own doc comment.
    reportMorningSweepAnomalies(morningSweep, new Date())
  } catch (err) {
    morningSweep = reportMorningSweepError(err)
  }

  // Item F -- the outbound-send coverage/stuck-claim sweep (docs/plans/
  // pass1-outbound-send-plan.md, Amendment (b), F1). Same placement and
  // isolation discipline as the morning sweep immediately above: runs every
  // tick, time-triggered rather than queued, isolated in its own try/catch
  // so a failure here never prevents job claiming/processing from running
  // this tick, and never silently swallowed either (reportOutboundCoverage-
  // SweepError, same shape as reportMorningSweepError).
  let outboundCoverage: CoverageSweepResult | { error: string }
  try {
    outboundCoverage = await runOutboundCoverageSweep(client, new Date())
    reportOutboundCoverageAnomalies(outboundCoverage)
  } catch (err) {
    outboundCoverage = reportOutboundCoverageSweepError(err)
  }

  // Check-in escalation sweep (lib/checkin-escalations/sweep.ts) — same
  // placement and isolation discipline as the two sweeps immediately above:
  // runs every tick, time-triggered rather than queued, isolated in its own
  // try/catch so a failure here never prevents job claiming/processing from
  // running this tick, and never silently swallowed either
  // (reportCheckinEscalationSweepError, same shape as the other two). It
  // loops active projects x both halves internally and isolates each
  // (project, half) call on its own — see CheckinEscalationSweepResult's own
  // doc comment for why a single bad project must not abort the rest.
  //
  // Writes escalation STATE ONLY — it sends nothing. Per status.ts's own
  // CORRECTION 1, determineTargetStatus never produces 'nudged' and this
  // sweep never sets nudge_sent_at, so a row can legitimately jump
  // awaited -> escalated with no message ever sent to the engineer. That is
  // correct and intended (self-repairing once a sender slice exists), not a
  // bug to work around here.
  let checkinEscalations: CheckinEscalationSweepResult | { error: string }
  try {
    checkinEscalations = await runCheckinEscalationTickSweep(client, new Date())
    reportCheckinEscalationSweepAnomalies(checkinEscalations, new Date())
  } catch (err) {
    checkinEscalations = reportCheckinEscalationSweepError(err)
  }

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
        // hindrance_pm_notify has no dead-letter business state of its own
        // (unlike dpr_generate's dprs.generation_status) -- pm_notified_at
        // just stays NULL forever once retries are exhausted, silently,
        // unless something says so. Given how much weight this
        // notification's own reliability carries (Aravind, 2026-09-06:
        // "the first question is whether the email actually reaches a
        // human"), retry exhaustion gets an explicit, loud alert here
        // rather than inheriting the silent-dead-row gap every OTHER job
        // type in this switch still has.
        //
        // CHANGED, migration 044 (stage 2). This job's own retry budget is
        // now ALSO how handleHindrancePmNotifyJob waits for its
        // hindrance's photos to finish uploading (it throws a retryable
        // error while photos_status='pending' -- see that function's own
        // header). On exhaustion, retrying blindly again would never send
        // the email at all if photos never finish -- Aravind's 2026-09-14
        // decision is the email is NEVER withheld, so exhaustion here
        // means ONE FINAL forced send, without waiting for photos any
        // longer. Only if THAT also fails does this fall back to the
        // original "PM never notified" alert -- a genuinely last resort
        // (e.g. Resend itself is down), not the common case.
        if (!willRetry && job.type === 'hindrance_pm_notify') {
          const payload = job.payload as unknown as HindrancePmNotifyJobPayload
          try {
            await handleHindrancePmNotifyJob(payload, { supabaseClient: client, forceSendWithoutPhotos: true })
          } catch (forcedErr) {
            const forcedMessage = forcedErr instanceof Error ? forcedErr.message : String(forcedErr)
            Sentry.captureMessage('hindrance_pm_notify: job exhausted all retries -- PM never notified', {
              level: 'error',
              fingerprint: ['hindrance-pm-notify', 'dead_letter', job.id],
              tags: { feature: 'hindrance-pm-notify' },
              extra: { jobId: job.id, payload: job.payload, lastError: message, forcedSendError: forcedMessage },
            })
          }
        }
        // media_ingest dead-letter (stage 1) -- see lib/media/ingest.ts's
        // own markMediaIngestFailed for the exact writes/alert. No PM-
        // visible surface exists yet (stage 5); this is the entire interim
        // failure surface, same posture as item 4's own design.
        if (!willRetry && job.type === 'media_ingest') {
          const payload = job.payload as unknown as MediaIngestJobPayload
          await markMediaIngestFailed(client, payload, message)
        }
        // hindrance_media_ingest dead-letter (stage 2) -- see
        // lib/media/hindrance-ingest.ts's own markHindranceMediaIngestFailed.
        // UNLIKE media_ingest's dead-letter, this one has a real, live
        // downstream consumer today: it moves photos_status to 'failed',
        // which is exactly what unblocks handleHindrancePmNotifyJob's own
        // retry-until-ready check above from waiting forever.
        if (!willRetry && job.type === 'hindrance_media_ingest') {
          const payload = job.payload as unknown as HindranceMediaIngestJobPayload
          await markHindranceMediaIngestFailed(client, payload, message)
        }
        return { id: job.id, status: 'failed', willRetry, error: message }
      }
    }),
  )

  return {
    claimed: jobs.length,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
    morningSweep,
    outboundCoverage,
    checkinEscalations,
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
