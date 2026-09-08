import * as Sentry from '@sentry/nextjs'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { istDateString } from '@/lib/daily-logs/date'

// DASH-07 Phase 1 — PM hindrance queue, READ-ONLY (docs/plans/
// dash-07-hindrance-queue.md). No acknowledgement write here; the
// acknowledged_at/acknowledged_by columns don't exist yet (other track).
//
// SCOPING (CLAUDE.md §4): hindrances_select RLS (002_rls_policies.sql:
// 249-251) is TENANT-wide, not project-scoped -- byte-identical in shape to
// daily_logs_select (172-174), the established pre-023 pattern this app
// already ships around via app-layer project_members filtering (see
// lib/daily-logs/query.ts's getDailyLogsBoard). This module does the same,
// filtered to role='pm' specifically -- see docs/plans/dash-07-hindrance-
// queue.md's §RLS findings and §Open item 2 for why role='pm' (not
// unfiltered membership, and never users.role).

export type HindranceTiming = 'active' | 'unspecified' | 'potential'

const TIMING_RANK: Record<HindranceTiming, number> = {
  active: 0,
  unspecified: 1,
  potential: 2,
}

function isKnownTiming(value: string | null): value is HindranceTiming {
  return value === 'active' || value === 'unspecified' || value === 'potential'
}

export const HINDRANCE_WINDOW_DAYS = 14

// Whole calendar-day difference between two 'YYYY-MM-DD' strings. Diffing
// the calendar-day strings themselves (via their UTC-midnight
// representations) rather than the original instants is what keeps this
// exact across the IST offset -- see withinHindranceWindow's own comment.
function calendarDaysBetween(earlier: string, later: string): number {
  const [ey, em, ed] = earlier.split('-').map(Number)
  const [ly, lm, ld] = later.split('-').map(Number)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / msPerDay)
}

/**
 * The window -- ONE named predicate, IST calendar days via istDateString(),
 * never a UTC instant subtraction (UTC drifts by 5h30m off IST and can drop
 * an item on the wrong calendar day). `active` is exempt as an explicit
 * clause: it never falls out of the window, at any age
 * (docs/plans/dash-07-hindrance-queue.md §The window). Everything else --
 * `potential` and `unspecified` alike -- gets the 14-day window; the spec
 * names only `active` as the exemption, so nothing else is assumed exempt.
 */
export function withinHindranceWindow(timing: HindranceTiming, createdAt: string, now: Date): boolean {
  if (timing === 'active') return true
  const created = istDateString(new Date(createdAt))
  const today = istDateString(now)
  return calendarDaysBetween(created, today) <= HINDRANCE_WINDOW_DAYS
}

/**
 * active -> unspecified -> potential, oldest first within each group
 * (docs/plans/dash-07-hindrance-queue.md §Ordering). `unspecified` outranks
 * `potential` deliberately: an unclassified answer might be blocking right
 * now, so unknown urgency sits above known-not-yet-urgent.
 */
export function orderHindranceQueue<T extends { timing: HindranceTiming; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = TIMING_RANK[a.timing] - TIMING_RANK[b.timing]
    if (rankDiff !== 0) return rankDiff
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

export type HindranceCard = {
  id: string
  projectId: string
  projectName: string
  timing: HindranceTiming
  description: string | null
  timingRaw: string | null
  reporterName: string
  createdAt: string
}

export type HindranceQueueResult =
  | { status: 'not-a-pm' }
  | { status: 'ok'; items: HindranceCard[]; hasAnyEver: boolean }
  | { status: 'error' }

function reportReadFailure(stage: string, error: PostgrestError): { status: 'error' } {
  Sentry.captureException(error, { tags: { feature: 'dash-07-hindrance-queue', stage } })
  return { status: 'error' }
}

type MemberProjectRow = { project_id: string; projects: { name: string } | null }
type HindranceRow = {
  id: string
  project_id: string
  description: string | null
  timing: string | null
  timing_raw: string | null
  reported_by: string
  created_at: string
}

/**
 * Read a PM's hindrance queue, oldest-first within active/unspecified/
 * potential groups, windowed per withinHindranceWindow. `hasAnyEver`
 * distinguishes the two non-PM empty copies: "nothing ever reported" vs.
 * "things exist, none in the window" (docs/plans/dash-07-hindrance-
 * queue.md's Copy table) -- it is computed off the UNWINDOWED read, before
 * either the window or the known-timing filter runs.
 */
export async function getHindranceQueue(
  supabase: SupabaseClient<Database>,
  pmUserId: string,
  now: Date,
): Promise<HindranceQueueResult> {
  const { data: memberData, error: memberErr } = await supabase
    .from('project_members')
    .select('project_id, projects(name)')
    .eq('user_id', pmUserId)
    .eq('role', 'pm')

  if (memberErr) return reportReadFailure('projects', memberErr)

  const members = (memberData ?? []) as unknown as MemberProjectRow[]
  if (members.length === 0) return { status: 'not-a-pm' }

  const projectNameById = new Map<string, string>()
  for (const m of members) {
    if (m.projects) projectNameById.set(m.project_id, m.projects.name)
  }
  const projectIds = [...projectNameById.keys()]

  const { data: rawData, error: hindrancesErr } = await supabase
    .from('hindrances')
    .select('id, project_id, description, timing, timing_raw, reported_by, created_at')
    .in('project_id', projectIds)

  if (hindrancesErr) return reportReadFailure('hindrances', hindrancesErr)

  const rawRows = (rawData ?? []) as unknown as HindranceRow[]
  const hasAnyEver = rawRows.length > 0

  const knownRows: (HindranceRow & { timing: HindranceTiming })[] = []
  for (const r of rawRows) {
    if (isKnownTiming(r.timing)) {
      knownRows.push(r as HindranceRow & { timing: HindranceTiming })
      continue
    }
    // 036's CHECK allows NULL, but the flow (038) always sets one of the
    // three known values on insert -- this should never happen for a real
    // row. Skip and surface rather than guess a chip for it (never invent a
    // fourth status -- docs/plans/dash-07-hindrance-queue.md §Status roles).
    Sentry.captureMessage('hindrance row has an unrecognised timing value, skipped from the PM queue', {
      level: 'warning',
      tags: { feature: 'dash-07-hindrance-queue' },
      extra: { hindranceId: r.id, timing: r.timing },
    })
  }

  const windowed = knownRows.filter((r) => withinHindranceWindow(r.timing, r.created_at, now))
  if (windowed.length === 0) return { status: 'ok', items: [], hasAnyEver }

  const reporterIds = [...new Set(windowed.map((r) => r.reported_by))]
  const { data: reporterData, error: reporterErr } = await supabase
    .from('users')
    .select('id, full_name')
    .in('id', reporterIds)

  if (reporterErr) return reportReadFailure('reporters', reporterErr)

  const reporterNameById = new Map<string, string>()
  for (const u of (reporterData ?? []) as unknown as { id: string; full_name: string | null }[]) {
    reporterNameById.set(u.id, u.full_name ?? 'Unnamed engineer')
  }

  const items: HindranceCard[] = windowed.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: projectNameById.get(r.project_id) ?? '—',
    timing: r.timing,
    description: r.description,
    timingRaw: r.timing_raw,
    reporterName: reporterNameById.get(r.reported_by) ?? 'Unnamed engineer',
    createdAt: r.created_at,
  }))

  return { status: 'ok', items: orderHindranceQueue(items), hasAnyEver }
}
