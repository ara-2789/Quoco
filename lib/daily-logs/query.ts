import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LogHalfInput } from './status'
import { UI_VISIBLE_COLUMNS, type CorrectableColumn } from './correction'

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
  /** E.164 (with +) or null — the column is nullable. Used only to build the
   *  reactivation "Forward to" wa.me link; never displayed directly. */
  engineerWhatsappNumber: string | null
  /** The daily_logs row for this engineer on this date, or null if none exists. */
  log:
    | (LogHalfInput & {
        /** daily_logs.id — links the board card to the DASH-03 correction detail route. */
        id: string
        evening_output: string | null
        morning_plan: string | null
      })
    | null
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
  users: {
    id: string
    full_name: string | null
    messaging_blocked: boolean | null
    whatsapp_number: string | null
  } | null
}
type LogRow = LogHalfInput & {
  id: string
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
      .select('project_id, users(id, full_name, messaging_blocked, whatsapp_number)')
      .in('project_id', projectIds)
      .eq('role', 'engineer'),
    supabase
      .from('daily_logs')
      .select(
        'id, project_id, engineer_id, morning_submitted_at, evening_submitted_at, is_holiday, holiday_reason, evening_output, morning_plan',
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
      engineerWhatsappNumber: r.users.whatsapp_number ?? null,
      log: log
        ? {
            id: log.id,
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

// -----------------------------------------------------------------------------
// DASH-03 correction detail route — getDailyLogDetail
// -----------------------------------------------------------------------------

export type LatestEdit = {
  newValue: unknown
  oldValue: unknown
  editedById: string
  /** 'you' when edited_by === the viewer, else the editor's name (or a fallback). */
  editedByName: string
  editedAt: string
}

export type LogDetail = {
  id: string
  projectId: string
  engineerId: string
  engineerName: string
  messagingBlocked: boolean
  logDate: string
  morningSubmittedAt: string | null
  eveningSubmittedAt: string | null
  /** Current value of every UI-visible correctable column (§ correction.ts), keyed by column name. */
  columns: Record<CorrectableColumn, unknown>
  /** attendance_defaulted / attendance_raw (030) — is_holiday's defaulted-provenance case. NOTE:
   *  types/database.ts has not been regenerated since 030 landed these columns (see the
   *  prerequisite-PR note in the detail page) — this select is correct against the LIVE schema;
   *  it may not type-check cleanly until that regen lands, which is expected, not a bug here. */
  attendanceDefaulted: boolean | null
  attendanceRaw: string | null
  /** Latest daily_log_edits row per corrected column, keyed by column name. An un-edited column is absent. */
  edits: Partial<Record<CorrectableColumn, LatestEdit>>
}

export type LogDetailResult =
  | { status: 'ok'; data: LogDetail }
  | { status: 'not-found' }
  | { status: 'error' }

const DETAIL_COLUMNS = [
  'id',
  'project_id',
  'engineer_id',
  'log_date',
  'morning_submitted_at',
  'evening_submitted_at',
  'attendance_defaulted',
  'attendance_raw',
  ...UI_VISIBLE_COLUMNS,
] as const

type DetailRow = {
  id: string
  project_id: string
  engineer_id: string
  log_date: string
  morning_submitted_at: string | null
  evening_submitted_at: string | null
  attendance_defaulted: boolean | null
  attendance_raw: string | null
} & Record<CorrectableColumn, unknown>

type EditRow = {
  column_name: string
  old_value: unknown
  new_value: unknown
  edited_by: string
  created_at: string
}

/**
 * DASH-03 correction detail read. RLS on daily_logs is TENANT-wide
 * (007:282), not project-scoped — the same gap migration 019's own RPC guard
 * (f) closes at the write layer. This read closes it explicitly too, rather
 * than relying on RLS for project scope. Membership check is role-agnostic:
 * any project_members row grants READ access (§10's role gate hides EDIT
 * affordances at the component layer, not here) — a same-tenant, non-member
 * project's row is deliberately indistinguishable from a genuinely missing
 * one ('not-found' either way, never leaking which case it was).
 */
export async function getDailyLogDetail(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  logId: string,
): Promise<LogDetailResult> {
  const { data: rowData, error: rowErr } = await supabase
    .from('daily_logs')
    .select(DETAIL_COLUMNS.join(', '))
    .eq('id', logId)
    .maybeSingle()

  if (rowErr) return reportReadFailure('detail-row', rowErr)
  if (!rowData) return { status: 'not-found' }
  const row = rowData as unknown as DetailRow

  const { data: memberRow, error: memberErr } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', row.project_id)
    .eq('user_id', viewerId)
    .maybeSingle()

  if (memberErr) return reportReadFailure('detail-membership', memberErr)
  if (!memberRow) return { status: 'not-found' }

  // profile-lookup-guard:allow-id-eq — row.engineer_id is a resolved
  // users.id (daily_logs.engineer_id, same call shape as lib/dpr/
  // dispatch.ts's own engineer lookup), never an auth uid, so the pre-007
  // lookup bug (getProfile/profileForAuthId key on auth_id; this doesn't)
  // cannot occur here.
  const { data: engineerData, error: engineerErr } = await supabase
    .from('users')
    .select('full_name, messaging_blocked')
    .eq('id', row.engineer_id)
    .maybeSingle()

  if (engineerErr) return reportReadFailure('detail-engineer', engineerErr)
  const engineer = engineerData as unknown as { full_name: string | null; messaging_blocked: boolean | null } | null

  // Every edit for this row, oldest first. A plain client-side reduce
  // (overwrite-on-iterate) gives "latest per column" without a SQL DISTINCT
  // ON — edit volume per row is tiny, no pagination needed.
  const { data: editData, error: editsErr } = await supabase
    .from('daily_log_edits')
    .select('column_name, old_value, new_value, edited_by, created_at')
    .eq('daily_logs_id', logId)
    .order('created_at', { ascending: true })

  if (editsErr) return reportReadFailure('detail-edits', editsErr)

  const editsByColumn = new Map<string, EditRow>()
  for (const e of (editData ?? []) as unknown as EditRow[]) {
    editsByColumn.set(e.column_name, e)
  }

  // Names for any editor other than the viewer — "Corrected by you" vs.
  // "Corrected by <name>" (§8).
  const editorIds = [...new Set([...editsByColumn.values()].map((e) => e.edited_by))].filter(
    (id) => id !== viewerId,
  )
  const editorNames = new Map<string, string>()
  if (editorIds.length > 0) {
    const { data: editorData, error: editorErr } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', editorIds)
    if (editorErr) return reportReadFailure('detail-editors', editorErr)
    for (const u of (editorData ?? []) as unknown as { id: string; full_name: string | null }[]) {
      editorNames.set(u.id, u.full_name ?? 'another PM')
    }
  }

  const edits: Partial<Record<CorrectableColumn, LatestEdit>> = {}
  for (const column of UI_VISIBLE_COLUMNS) {
    const e = editsByColumn.get(column)
    if (!e) continue
    edits[column] = {
      newValue: e.new_value,
      oldValue: e.old_value,
      editedById: e.edited_by,
      editedByName: e.edited_by === viewerId ? 'you' : (editorNames.get(e.edited_by) ?? 'another PM'),
      editedAt: e.created_at,
    }
  }

  const columns = {} as Record<CorrectableColumn, unknown>
  for (const column of UI_VISIBLE_COLUMNS) columns[column] = row[column]

  return {
    status: 'ok',
    data: {
      id: row.id,
      projectId: row.project_id,
      engineerId: row.engineer_id,
      engineerName: engineer?.full_name ?? 'Unnamed engineer',
      messagingBlocked: engineer?.messaging_blocked ?? false,
      logDate: row.log_date,
      morningSubmittedAt: row.morning_submitted_at,
      eveningSubmittedAt: row.evening_submitted_at,
      columns,
      attendanceDefaulted: row.attendance_defaulted,
      attendanceRaw: row.attendance_raw,
      edits,
    },
  }
}
