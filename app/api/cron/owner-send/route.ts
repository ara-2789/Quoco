import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { enqueueJob } from '@/lib/queue/jobs'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { istDateString } from '@/lib/daily-logs/date'

// CHECKIN_CHECKPOINTS.ownerSend IST trigger (lib/daily-logs/cutoffs.ts,
// already defined: '20:30', "the automatic, unconditional owner send.
// Never gated on a PM action") -- enqueues one owner_deliver job per
// ACTIVE PROJECT WITH AN OWNER, for today's log_date. Does the actual
// per-engineer resolution, routing (report vs. no-report notice), and
// send inside the job handler (lib/dpr/owner-deliver-dispatch.ts), never
// here -- same NFR-16 discipline as dpr-generate's own trigger route.
//
// NO ROSTER QUERY -- a real, load-bearing difference from dpr-generate's
// own trigger, not an oversight. dpr-generate must resolve WHICH
// ENGINEERS are eligible before enqueueing, because it enqueues one job
// per engineer. owner_deliver is deliberately one job per
// (project_id, log_date) -- handleOwnerDeliverJob already resolves every
// engineer's dprs row internally. This route's only job is deciding
// WHICH PROJECTS get a job at all.
//
// PER-PROJECT ISOLATION -- A DELIBERATE DIVERGENCE FROM dpr-generate's
// OWN SHAPE, NOT DRIFT (Aravind, 2026-09-03). dpr-generate's trigger loop
// has no per-project try/catch: a thrown error partway through aborts the
// whole batch for every remaining project that night. That is an
// acceptable trade-off THERE because a missed generation can be re-run --
// scripts/generate-one-dpr.ts exists precisely for that. It is NOT an
// acceptable trade-off HERE: owner-send failing partway through means
// projects 4 through 10 get NO REPORT that day, with no recovery path --
// nobody is notified, the next night's run moves on to today's date, and
// those owners simply never receive anything for the day that silently
// dropped. This route therefore wraps EACH project's own processing in
// its own try/catch: a Sentry capture per failure, the loop continues to
// the next project regardless.
//
// FOLLOW-UP, RECORDED HERE, NOT FOLDED IN THERE (same reasoning, not yet
// acted on): the identical argument arguably applies to dpr-generate's
// own trigger -- a thrown error on project 3 of 10 silently drops
// generation for projects 4 through 10 that night too, and while
// generate-one-dpr.ts CAN re-run it by hand, nothing today detects that
// it needs to. Not changed here; a separate, deliberate decision for
// whoever picks it up. See app/api/cron/dpr-generate/route.ts's own
// header for the matching note.
//
// SKIP-AND-SURFACE FOR OWNER-LESS PROJECTS, NOT A SILENT NO-OP AND NOT AN
// ERROR: an active project with no owner_user_id is expected, ongoing
// state during beta rollout (most projects won't have an owner
// provisioned yet), not a bug -- same shape as dpr-generate's own Q8
// precedent for "zero eligible engineers" (a warning-level Sentry
// capture, a result entry, no thrown error, no retry). Checked in the
// loop, not filtered out of the SQL query, for the identical reason Q8's
// zero-eligible check lives in the loop: it needs to produce a visible,
// per-project result and Sentry signal, not just vanish from a WHERE
// clause.
//
// TWO-FIELD DEDUP IS EXACT, NOT JUST CONVENTIONAL -- worth naming because
// dpr-generate's own dedup check has a real incident behind it (B2: a
// three-field payload whose dedup match once omitted engineer_id,
// letting JSONB containment silently swallow engineers 2..N as
// "already_queued"). owner_deliver's payload is exactly {project_id,
// log_date} -- both fields are already in this route's own match, so
// there is no third field to omit and no equivalent risk.

export interface OwnerSendTriggerResult {
  project_id: string
  outcome: 'enqueued' | 'already_queued' | 'skipped_no_owner' | 'failed'
  error?: string
}

/**
 * The real logic, extracted from GET so a test can call it directly with
 * an injected client -- same shape as runDprGenerateTrigger (app/api/cron/
 * dpr-generate/route.ts): GET below is a thin wrapper supplying today's
 * production default. logDate is a parameter (not computed inside) so a
 * test can pin it without faking `Date`. enqueueJobFn is injectable (same
 * DI shape as owner-deliver-dispatch.ts's own sendEmailFn/sendWhatsAppFn)
 * so a test can simulate ONE project's enqueue failing without needing a
 * real database-level failure.
 */
export async function runOwnerSendTrigger(
  client: SupabaseClient,
  logDate: string,
  deps: { enqueueJobFn?: typeof enqueueJob } = {},
): Promise<OwnerSendTriggerResult[]> {
  const enqueue = deps.enqueueJobFn ?? enqueueJob

  const { data: projects, error: projectsError } = await client
    .from('projects')
    .select('id, tenant_id, owner_user_id')
    .eq('status', 'active')
  if (projectsError) throw projectsError

  const results: OwnerSendTriggerResult[] = []

  for (const project of projects ?? []) {
    try {
      if (!project.owner_user_id) {
        Sentry.captureMessage('owner-send: active project has no owner_user_id set', {
          level: 'warning',
          tags: { feature: 'owner-send' },
          extra: { project_id: project.id, log_date: logDate },
        })
        results.push({ project_id: project.id, outcome: 'skipped_no_owner' })
        continue
      }

      const { data: existingJobs, error: existingJobsError } = await client
        .from('jobs')
        .select('id')
        .eq('type', 'owner_deliver')
        .in('status', ['pending', 'running'])
        .contains('payload', { project_id: project.id, log_date: logDate })
        .limit(1)
      if (existingJobsError) throw existingJobsError

      if (existingJobs && existingJobs.length > 0) {
        results.push({ project_id: project.id, outcome: 'already_queued' })
        continue
      }

      await enqueue('owner_deliver', { project_id: project.id, log_date: logDate }, client)
      results.push({ project_id: project.id, outcome: 'enqueued' })
    } catch (err) {
      // PER-PROJECT ISOLATION -- see this file's own header for why this
      // diverges from dpr-generate's own shape. One project's failure
      // must never prevent the rest of the batch from running.
      const message = err instanceof Error ? err.message : String(err)
      Sentry.captureException(err, {
        fingerprint: ['owner-send', 'project_failed', project.id],
        tags: { feature: 'owner-send' },
        extra: { project_id: project.id, log_date: logDate },
      })
      results.push({ project_id: project.id, outcome: 'failed', error: message })
    }
  }

  return results
}

export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const logDate = istDateString(new Date())
  try {
    const results = await runOwnerSendTrigger(createServiceClient(), logDate)
    return NextResponse.json({ log_date: logDate, projects: results.length, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
