import type { SupabaseClient } from '@supabase/supabase-js'
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
): Promise<ProjectBoard[]> {
  // 1. The PM's projects (scope).
  const { data: memberData } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name)')
    .eq('user_id', pmUserId)

  const projects = ((memberData ?? []) as unknown as MemberProject[]).filter(
    (m): m is MemberProject & { projects: { id: string; name: string } } =>
      m.projects !== null,
  )
  const projectIds = projects.map((p) => p.project_id)
  if (projectIds.length === 0) return []

  // 2. Engineer roster for those projects + 3. logs for the date — independent,
  // run concurrently.
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
  return boards.sort((a, b) => a.projectName.localeCompare(b.projectName))
}

/** IST calendar date "YYYY-MM-DD" for a UTC instant (the board's default date). */
export function istDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
