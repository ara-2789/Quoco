import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LogHalfInput } from './status'

// Data layer for the Daily Logs board (DASH-03).
//
// Scoping (CLAUDE.md §4): everything is bounded to the projects where the PM has
// a project_members row — NOT all tenant projects. RLS enforces tenant isolation
// underneath; this project_members filter is the project-scope layer on top.
//
// The card list is driven by the ENGINEER ROSTER (project_members role=engineer),
// left-joined to daily_logs for the date — never off daily_logs rows alone, or an
// engineer who submitted nothing would silently vanish (the opposite of Rule 4.5).

export type EngineerCard = {
  engineerId: string
  engineerName: string
  messagingBlocked: boolean
  /** The daily_logs row for this engineer on this date, or null if none exists. */
  log: (LogHalfInput & { evening_output: string | null; morning_plan: string | null }) | null
}

export type ProjectBoard = {
  projectId: string
  projectName: string
  engineers: EngineerCard[]
}

// Discriminated result so the page can tell "loaded, genuinely empty" apart from
// "the read FAILED". A failed read must NEVER fall through to an empty/all-amber
// board — that would render a data-loss event as "nobody checked in" (B1).
export type BoardResult =
  | { status: 'ok'; boards: ProjectBoard[] }
  | { status: 'error' }

// Report a failed board read to Sentry and return the error result. Centralised
// so all three queries surface identically (loud event, not a silent lie).
function reportReadFailure(stage: string, error: PostgrestError): { status: 'error' } {
  Sentry.captureException(error, {
    tags: { feature: 'dash-03-daily-logs', stage },
  })
  return { status: 'error' }
}

type MemberProject = { project_id: string; projects: { id: string; name: string } | null }
type RosterRow = {
  project_id: string
  users: { id: string; full_name: string | null; messaging_blocked: boolean | null } | null
}
type LogRow = LogHalfInput & {
  project_id: string
  engineer_id: string
  evening_output: string | null
  morning_plan: string | null
}

export async function getDailyLogsBoard(
  supabase: SupabaseClient<Database>,
  pmUserId: string,
  logDate: string,
): Promise<BoardResult> {
  // 1. The PM's projects (scope). A read error here is fatal to the board — do
  // NOT discard it and proceed with an empty project set (B1).
  const { data: memberData, error: memberErr } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name)')
    .eq('user_id', pmUserId)

  if (memberErr) return reportReadFailure('projects', memberErr)

  const projects = ((memberData ?? []) as unknown as MemberProject[]).filter(
    (m): m is MemberProject & { projects: { id: string; name: string } } =>
      m.projects !== null,
  )
  const projectIds = projects.map((p) => p.project_id)
  if (projectIds.length === 0) return { status: 'ok', boards: [] }

  // 2. Engineer roster for those projects + 3. logs for the date — independent,
  // run concurrently. Either failing is fatal (a swallowed logs error would
  // render every half as "Not checked in" — the exact all-amber lie B1 bans).
  const [rosterRes, logsRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('project_id, users(id, full_name, messaging_blocked)')
      .in('project_id', projectIds)
      .eq('role', 'engineer'),
    supabase
      .from('daily_logs')
      .select(
        'project_id, engineer_id, morning_submitted_at, evening_submitted_at, is_holiday, holiday_reason, evening_output, morning_plan',
      )
      .in('project_id', projectIds)
      .eq('log_date', logDate),
  ])

  if (rosterRes.error) return reportReadFailure('roster', rosterRes.error)
  if (logsRes.error) return reportReadFailure('logs', logsRes.error)

  const roster = (rosterRes.data ?? []) as unknown as RosterRow[]
  const logs = (logsRes.data ?? []) as unknown as LogRow[]

  // 4. Merge, keyed by (project_id, engineer_id).
  const logByKey = new Map<string, LogRow>()
  for (const l of logs) logByKey.set(`${l.project_id}:${l.engineer_id}`, l)

  const boardByProject = new Map<string, ProjectBoard>()
  for (const p of projects) {
    boardByProject.set(p.project_id, {
      projectId: p.project_id,
      projectName: p.projects.name,
      engineers: [],
    })
  }

  for (const r of roster) {
    const board = boardByProject.get(r.project_id)
    if (!board || !r.users) continue
    const log = logByKey.get(`${r.project_id}:${r.users.id}`) ?? null
    board.engineers.push({
      engineerId: r.users.id,
      engineerName: r.users.full_name ?? 'Unnamed engineer',
      messagingBlocked: r.users.messaging_blocked ?? false,
      log: log
        ? {
            morning_submitted_at: log.morning_submitted_at,
            evening_submitted_at: log.evening_submitted_at,
            is_holiday: log.is_holiday,
            holiday_reason: log.holiday_reason,
            evening_output: log.evening_output,
            morning_plan: log.morning_plan,
          }
        : null,
    })
  }

  // Sort engineers by name for stable rendering; drop empty projects last.
  const boards = [...boardByProject.values()]
  for (const b of boards) b.engineers.sort((a, c) => a.engineerName.localeCompare(c.engineerName))
  boards.sort((a, b) => a.projectName.localeCompare(b.projectName))
  return { status: 'ok', boards }
}
