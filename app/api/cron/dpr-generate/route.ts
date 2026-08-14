import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { enqueueJob } from '@/lib/queue/jobs'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { istDateString } from '@/lib/daily-logs/date'

// 8:00 PM IST trigger (bot-flows.md TRIGGER TIMES) — enqueues one
// dpr_generate job per ELIGIBLE ENGINEER on each active project, per
// engineer, not one per project (docs/dpr-engineer-report-spec.md,
// implemented 2026-08-14 per plan revision 8). Does the actual Claude call
// and write inside the job handler (lib/dpr/dispatch.ts), never here —
// NFR-16, ALL Claude API calls run through the jobs table, never
// synchronously in a request handler.
//
// ELIGIBILITY (rewritten from the old project-level DPR-17 skip, review
// round 2 S3/round 3 Q8): the eligible set for each active project is the
// UNION of two queries —
//   SET 1 (roster): project_members JOIN users, role='engineer',
//     status='active' — same shape lib/dpr/accountability.ts's
//     assembleAccountability already uses, and PR #59's
//     lib/checkin-escalations/roster.ts mirrors for the same reason.
//   SET 2 (real data): daily_logs.engineer_id, DISTINCT, for this
//     project/log_date — an engineer who submitted real data and was then
//     deactivated or moved off the project before 20:00 still gets a
//     report (Rule 7's own real-data-wins principle, round-2 S3 finding).
// Every engineer in the union gets a job, UNCONDITIONALLY — there is no
// more project-level "skip" state. An engineer with zero daily_logs rows
// still gets a full report reading "not received" throughout (the
// silent-engineer fix this reformat exists to build).

export interface DprGenerateTriggerResult {
  project_id: string
  engineers_enqueued: number
  engineers_already_queued: number
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
    // SET 1 — active roster.
    const { data: members, error: membersError } = await client
      .from('project_members')
      .select('users!inner(id, role, status)')
      .eq('project_id', project.id)
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

    // SET 2 — real data, regardless of current roster membership (S3).
    const { data: logs, error: logsError } = await client
      .from('daily_logs')
      .select('engineer_id')
      .eq('project_id', project.id)
      .eq('log_date', logDate)
    if (logsError) throw logsError

    const dataEngineerIds = Array.from(new Set((logs ?? []).map((l) => l.engineer_id as string)))

    const eligibleIds = new Set<string>([...rosterIds, ...dataEngineerIds])

    // Q8 (round 3): zero-eligible-engineers on an active project is an
    // accepted gap (S4 — no dprs row is written, since engineer_id
    // NOT NULL makes a project-level marker incoherent), but detection is
    // IN SCOPE now, not deferred to a future incident.
    if (eligibleIds.size === 0) {
      Sentry.captureMessage('dpr-generate: active project resolved to zero eligible engineers', {
        level: 'warning',
        tags: { feature: 'dpr-generate' },
        extra: { project_id: project.id, log_date: logDate },
      })
      results.push({ project_id: project.id, engineers_enqueued: 0, engineers_already_queued: 0 })
      continue
    }

    let enqueued = 0
    let alreadyQueued = 0

    for (const engineer_id of eligibleIds) {
      // B2 fix (round 2, the dedup containment bug): the payload match
      // MUST include engineer_id. `.contains` is JSONB CONTAINMENT (@>),
      // not equality — without engineer_id in the match, engineer 1's
      // pending job (payload ⊇ {project_id, log_date, engineer_id: E1})
      // would still contain {project_id, log_date} as a subset, silently
      // swallowing engineers 2..N as "already_queued" and never enqueuing
      // them — an engineer who owed a check-in getting no report, the
      // exact failure class this whole reformat exists to close.
      const { data: existingJobs, error: existingJobsError } = await client
        .from('jobs')
        .select('id')
        .eq('type', 'dpr_generate')
        .in('status', ['pending', 'running'])
        .contains('payload', { project_id: project.id, engineer_id, log_date: logDate })
        .limit(1)
      if (existingJobsError) throw existingJobsError

      if (existingJobs && existingJobs.length > 0) {
        alreadyQueued++
        continue
      }

      await enqueueJob('dpr_generate', { project_id: project.id, engineer_id, log_date: logDate }, client)
      enqueued++
    }

    results.push({ project_id: project.id, engineers_enqueued: enqueued, engineers_already_queued: alreadyQueued })
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
