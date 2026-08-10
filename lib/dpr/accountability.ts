import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { AccountabilityEntry } from './schema'

// The accountability aggregator — §6, MISSING SUBMISSIONS ONLY. 100% code,
// no model call, no Judgment counterpart (schema.ts's AccountabilityEntry
// says why). Ships PER-DAY status only — the 7-day pattern is deliberately
// suppressed; see ACCOUNTABILITY_PATTERN_SUPPRESSED (schema.ts) and
// docs/design-decisions-beta-feedback.md §13 for the full reasoning.
//
// DIFFERENT FETCH SHAPE FROM lib/dpr/assemble.ts — DELIBERATELY, DO NOT
// LATER "SIMPLIFY" THIS INTO THE SAME QUERY. mergeDprFacts asks "what did
// the daily_logs rows that exist say" — it never needs to know who's
// missing, only what's present. This module asks the opposite question:
// section 6 reports MISSING submissions, and an engineer who submitted
// nothing has no daily_logs row at all — absence cannot be detected by
// reading rows that don't exist. The roster has to come from
// project_members (who SHOULD have submitted), not daily_logs (who DID).
// This is a left-join-and-look-for-NULL shape; the fact assembler is a
// fetch-what-exists shape. They will never converge into one query.

export interface RosterEngineer {
  engineer_id: string
  engineer_name: string
}

// What's needed from TODAY's daily_logs row, if one exists, for the whole
// roster on this project. Deliberately narrow — no window, no history: the
// pattern that would need a multi-day fetch is suppressed (see above), so
// today's aggregator only ever needs today.
export interface TodayLogRow {
  morning_submitted_at: string | null
  evening_submitted_at: string | null
  is_holiday: boolean | null
}

function statusFor(
  submittedAt: string | null,
  ownRowExists: boolean,
  ownIsHoliday: boolean,
  anyPeerHolidayReported: boolean,
): AccountabilityHalfStatusResult {
  if (submittedAt) return 'submitted'
  // LOAD-BEARING FOR EVENING — do not delete on the assumption this is
  // redundant with the submittedAt check above. For MORNING it genuinely
  // is redundant: a holiday reply IS the morning submission, so
  // morning_submitted_at is already set whenever is_holiday is, and the
  // branch above already returns 'submitted'. It is NOT redundant for
  // EVENING: BOT-20 suppresses the evening trigger entirely on a
  // site-closed day, so evening_submitted_at stays null even though this
  // engineer legitimately reported the closure that morning. Without this
  // branch, the one engineer who told us the site was closed would be the
  // one flagged with "no evening check-in recorded" — exactly backwards.
  // Covered by computeAccountability's "own holiday, evening suppressed by
  // BOT-20" test — do not remove either without the other.
  if (ownRowExists && ownIsHoliday) return 'submitted'
  // No row, but a PEER on the same project/day reported the site closed —
  // corroborating evidence, not proof (this engineer's own status is still
  // genuinely unknown), but per Rule 5.3 a name doesn't appear without
  // ruling out legitimate absence first, and this is the only ruling-out
  // this data can do.
  if (anyPeerHolidayReported) return 'unconfirmed'
  return 'missing'
}

type AccountabilityHalfStatusResult = 'submitted' | 'missing' | 'unconfirmed'

function noteFor(engineerName: string, morning: AccountabilityHalfStatusResult, evening: AccountabilityHalfStatusResult): string {
  // Factual, records-not-person wording throughout (schema.ts's
  // AccountabilityEntry.status_note note) — never "missed," "ignored," or
  // any verb implying the engineer did something. Corroborated cases name
  // the evidence without asserting it applies to this engineer too.
  const parts: string[] = []
  if (morning !== 'submitted') {
    parts.push(
      morning === 'unconfirmed'
        ? 'no morning check-in recorded (another engineer on this project reported the site closed today)'
        : 'no morning check-in recorded',
    )
  }
  if (evening !== 'submitted') {
    parts.push(
      evening === 'unconfirmed'
        ? 'no evening check-in recorded (another engineer on this project reported the site closed today)'
        : 'no evening check-in recorded',
    )
  }
  return `${engineerName} — ${parts.join('; ')}`
}

export function computeAccountability(roster: RosterEngineer[], todaysLogByEngineer: Map<string, TodayLogRow>): AccountabilityEntry[] {
  const anyPeerHolidayReported = Array.from(todaysLogByEngineer.values()).some((row) => row.is_holiday === true)

  const entries: AccountabilityEntry[] = []
  for (const engineer of roster) {
    const row = todaysLogByEngineer.get(engineer.engineer_id)
    const morning_status = statusFor(row?.morning_submitted_at ?? null, row !== undefined, row?.is_holiday === true, anyPeerHolidayReported)
    const evening_status = statusFor(row?.evening_submitted_at ?? null, row !== undefined, row?.is_holiday === true, anyPeerHolidayReported)

    // MISSING SUBMISSIONS ONLY — an engineer who submitted both halves (or
    // whose own row confirms a holiday) doesn't appear in §6 at all.
    if (morning_status === 'submitted' && evening_status === 'submitted') continue

    entries.push({
      engineer_name: engineer.engineer_name,
      morning_status,
      evening_status,
      // Always null — see ACCOUNTABILITY_PATTERN_SUPPRESSED (schema.ts).
      morning_pattern: null,
      evening_pattern: null,
      status_note: noteFor(engineer.engineer_name, morning_status, evening_status),
    })
  }
  return entries
}

// -----------------------------------------------------------------------
// Thin IO wrapper. Fetches the roster (project_members joined to users,
// role='engineer' AND status='active' — same filter shape as §12's prod
// evidence query) and today's daily_logs rows for that roster, via the
// INJECTED client (CLAUDE.md §10's CANDIDATE CI CHECK — no
// createServiceClient() buried in here).
// -----------------------------------------------------------------------

// Derived from the generated schema (types/database.ts), not hand-rolled —
// column drift (a rename, say) fails tsc, not silently at runtime.
type EngineerColumns = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'full_name'>

// Supabase/PostgREST resolves an embedded to-one relation as either a
// single object OR a one-element array depending on how the relationship
// is inferred — a known ambiguity, not hypothetical. lib/daily-logs/
// query.ts's RosterRow has the SAME project_members->users join and casts
// straight through `as unknown as RosterRow[]` with no runtime check —
// same latent bug there, not fixed here, flagging it as a related finding.
// Getting this wrong here is worse than there: if `users` resolves as an
// array, `.id` on an untyped object is `undefined`, every roster
// engineer_id is `undefined`, every Map lookup in computeAccountability
// misses, and §6 reports every engineer submitted nothing, every day, in a
// document the contractor's client reads. A roster of ghosts must fail
// loudly, not produce accusations — so this throws rather than proceeding
// with an unresolved or malformed row.
export function extractEngineerRow(rawUsers: unknown): EngineerColumns {
  const resolved = Array.isArray(rawUsers) ? rawUsers[0] : rawUsers
  const candidate = resolved as Partial<EngineerColumns> | null | undefined
  if (!candidate || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error(
      `assembleAccountability: project_members -> users join did not resolve to a valid user row (got ${JSON.stringify(rawUsers)}). Refusing to build a roster that could misname or silently drop an engineer.`,
    )
  }
  return { id: candidate.id, full_name: candidate.full_name ?? null }
}

export async function assembleAccountability(client: SupabaseClient, project_id: string, log_date: string): Promise<AccountabilityEntry[]> {
  const { data: members, error: membersError } = await client
    .from('project_members')
    .select('users!inner(id, full_name, role, status)')
    .eq('project_id', project_id)
    .eq('users.role', 'engineer')
    .eq('users.status', 'active')

  if (membersError) throw membersError

  const roster: RosterEngineer[] = (members ?? []).map((m) => {
    const engineerRow = extractEngineerRow((m as { users: unknown }).users)
    return { engineer_id: engineerRow.id, engineer_name: engineerRow.full_name ?? 'Unnamed engineer' }
  })

  if (roster.length === 0) return []

  const engineerIds = roster.map((r) => r.engineer_id)
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select('engineer_id, morning_submitted_at, evening_submitted_at, is_holiday')
    .eq('project_id', project_id)
    .eq('log_date', log_date)
    .in('engineer_id', engineerIds)

  if (logsError) throw logsError

  const todaysLogByEngineer = new Map<string, TodayLogRow>()
  for (const log of logs ?? []) {
    todaysLogByEngineer.set(log.engineer_id as string, {
      morning_submitted_at: log.morning_submitted_at as string | null,
      evening_submitted_at: log.evening_submitted_at as string | null,
      is_holiday: log.is_holiday as boolean | null,
    })
  }

  return computeAccountability(roster, todaysLogByEngineer)
}
