// Roster queries for the outbound send primitive (Pass 1 item B). Same
// project_members-JOIN-users shape as lib/dpr/accountability.ts and
// lib/checkin-escalations/roster.ts (roster comes from WHO SHOULD get a
// trigger, not from daily_logs -- an engineer with no daily_logs row yet
// is exactly who a trigger needs to reach), reusing extractEngineerRow so
// the array-vs-object PostgREST ambiguity is handled once, the same
// defensive way, everywhere it's handled at all.
//
// messaging_blocked FILTER, VERIFIED NOT A NULL HAZARD (2026-08-27):
// `.eq('users.messaging_blocked', false)` would silently exclude a row
// whose flag is NULL (Postgres: `NULL = false` is NULL, not true, so the
// row fails the filter) -- checked directly against PRODUCTION before
// deciding whether this needed a fix: `information_schema.columns` shows
// `messaging_blocked boolean NOT NULL DEFAULT false` (`is_nullable: 'NO'`),
// and a live count confirms zero NULL rows among engineers. The column
// cannot hold NULL; this filter is correct as written. Nothing changed
// here -- recorded so the next reader doesn't re-flag it without checking.

// KNOWN GAP: SupabaseClient here is bare, not SupabaseClient<Database> --
// every query in this file is unchecked against the real schema. See
// docs/reviews/outbound-untyped-supabase-client-gap.md for what it would
// take to close (not a one-line fix -- expect real errors to surface).
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { extractEngineerRow, type RosterEngineer } from '@/lib/dpr/accountability'

export interface OutboundRosterEngineer extends RosterEngineer {
  whatsapp_number: string
  tenant_id: string
}

// ROSTER CARDINALITY CIRCUIT BREAKER. Every row this function returns
// becomes a billed Twilio message once the (not-yet-built) item E caller
// loops over it. roster.length === 0 was, until this, the ONLY cardinality
// check anywhere in this file -- it catches an empty roster, never an
// EXPLODED one. A join regression (a dropped .eq(), an accidental fan-out
// through project_members) does not announce itself any other way -- it
// just bills every row.
//
// CEILING LIVES AS A HARDCODED CONSTANT -- argued, not picked silently:
//   - Env var: rejected. A safety ceiling that can be silently raised by a
//     misconfigured or forgotten environment variable is exactly the
//     "config surface that can be silently wrong" this project's own
//     ENABLE_TEST_FLOW_TRIGGER precedent already warns against
//     (lib/whatsapp/inbound-start.ts's own header, "a flag is a config
//     surface that can be silently wrong, exactly as that entry
//     demonstrates"). Changing a billing circuit breaker should cost a
//     deliberate code change + review, not a one-line env edit nobody
//     notices.
//   - Per-tenant: rejected as premature machinery for a single/few-tenant
//     beta (CLAUDE.md's own "don't build for hypothetical future scale"
//     rule) -- would need a new column or config table to serve a
//     cardinality this project does not have yet.
//   - Hardcoded constant: matches this codebase's own established pattern
//     for exactly this kind of safety threshold -- MAX_ATTEMPTS in
//     lib/queue/jobs.ts, CHECKIN_CHECKPOINTS in lib/daily-logs/cutoffs.ts,
//     MORNING_PLAN_MAX_CHARS in templates.ts -- all changed via code +
//     review, never a runtime knob.
//
// 50 is deliberately generous: today's honest roster is single digits.
const ROSTER_CARDINALITY_CEILING = 50

/**
 * Pure -- testable without a client or 51 real fixture rows. Throws (and
 * alerts) if `count` exceeds `ceiling`; the real call site below always
 * passes the hardcoded ROSTER_CARDINALITY_CEILING, but the ceiling is a
 * parameter here so a test can exercise the boundary with a small number
 * instead of constructing an oversized roster for real.
 */
export function checkRosterCardinality(count: number, ceiling: number, projectId: string, logDate: string): void {
  if (count <= ceiling) return
  Sentry.captureMessage('outbound-send: roster exceeded cardinality ceiling, checkpoint aborted', {
    level: 'error',
    fingerprint: ['outbound-send', 'roster_cardinality_exceeded', projectId, logDate],
    tags: { feature: 'outbound-send' },
    extra: { project_id: projectId, log_date: logDate, roster_size: count, ceiling },
  })
  throw new Error(
    `fetchActiveEngineers: roster for project ${projectId} on ${logDate} returned ${count} engineers, ` +
      `exceeding the ${ceiling}-engineer circuit breaker -- aborting the whole checkpoint rather than risk ` +
      `a join-regression cross-product billing every row. Investigate before retrying.`,
  )
}

export interface UnreachableEngineer {
  engineerId: string
  reason: 'missing_whatsapp_number' | 'missing_tenant_id'
}

/**
 * Pure resolver -- testable without a client. An engineer whose join
 * resolves but is missing `whatsapp_number` or `tenant_id` must NOT enter
 * the roster: a missing `whatsapp_number` would otherwise burn a real
 * `outbound_sends` claim row and take a Twilio 4xx, losing that engineer's
 * whole day for the checkpoint (the identical failure shape the 429 fix
 * exists to prevent, from a different cause); a missing `tenant_id` would
 * fail `outbound_sends`' own composite FK and throw mid-roster, taking out
 * every engineer after this one in the same loop. Both are excluded here
 * instead -- `fetchActiveEngineers` reports each one via Sentry rather
 * than silently dropping it (an unreachable engineer is a real finding a
 * PM needs, per design-principles' own "never a silent mystery" rule --
 * same discipline as `reportMorningSweepAnomalies`, not a new one).
 * `extractEngineerRow`'s own throw (a malformed join -- `id` itself
 * missing) is a different, more severe class and is left to propagate
 * unchanged; this function only handles a join that resolved correctly
 * but has null-ish contact/tenant data.
 */
export function resolveRosterEngineer(
  raw: unknown,
): { engineer: OutboundRosterEngineer } | { unreachable: UnreachableEngineer } {
  const row = extractEngineerRow(raw)
  const resolved = Array.isArray(raw) ? raw[0] : raw
  const typed = resolved as { whatsapp_number?: string | null; tenant_id?: string | null } | null

  const whatsappNumber = typed?.whatsapp_number
  if (!whatsappNumber) {
    return { unreachable: { engineerId: row.id, reason: 'missing_whatsapp_number' } }
  }
  const tenantId = typed?.tenant_id
  if (!tenantId) {
    return { unreachable: { engineerId: row.id, reason: 'missing_tenant_id' } }
  }
  return {
    engineer: {
      engineer_id: row.id,
      engineer_name: row.full_name ?? 'Unnamed engineer',
      whatsapp_number: whatsappNumber,
      tenant_id: tenantId,
    },
  }
}

/**
 * DEDUP, same convention as `reportMorningSweepAnomalies`
 * (lib/daily-logs/morning-cutoff-sweep.ts): fingerprint on
 * (feature, reason, engineer, IST calendar date) so a still-unreachable
 * engineer re-evaluated every tick collapses into one growing issue per
 * day instead of paging on every cron invocation, while a genuinely new
 * day surfaces as a fresh issue rather than vanishing into an old,
 * already-triaged one.
 */
function reportUnreachableEngineer(u: UnreachableEngineer, projectId: string, logDate: string): void {
  Sentry.captureMessage('outbound-send: engineer excluded from roster, missing whatsapp_number or tenant_id', {
    level: 'warning',
    fingerprint: ['outbound-send', 'unreachable-engineer', u.reason, u.engineerId, logDate],
    tags: { feature: 'outbound-send', reason: u.reason },
    extra: { engineer_id: u.engineerId, project_id: projectId, log_date: logDate },
  })
}

async function fetchActiveEngineers(
  client: SupabaseClient,
  projectId: string,
  logDate: string,
): Promise<OutboundRosterEngineer[]> {
  // messaging_blocked EXCLUDED here, unlike lib/checkin-escalations/
  // roster.ts's own roster (that module deliberately keeps a blocked
  // engineer visible so a PM sees the gap, per that file's own header).
  // This is a DIFFERENT query for a DIFFERENT purpose: this roster feeds a
  // real Twilio send attempt, and plan §5's own failure-mode table is
  // explicit -- "Excluded from the roster query BEFORE any claim/send
  // attempt... no ledger row, no Twilio call, no error." Do not converge
  // these two rosters; they exist for opposite reasons.
  const { data: members, error } = await client
    .from('project_members')
    .select('users!inner(id, full_name, role, status, whatsapp_number, tenant_id, messaging_blocked)')
    .eq('project_id', projectId)
    .eq('users.role', 'engineer')
    .eq('users.status', 'active')
    .eq('users.messaging_blocked', false)

  if (error) throw error

  // Checked on the RAW join result, before any per-row exclusion --
  // exclusions could only ever shrink this count, so checking here catches
  // a cross-product at its actual source rather than risking it being
  // masked by unrelated rows later getting filtered out as unreachable.
  checkRosterCardinality((members ?? []).length, ROSTER_CARDINALITY_CEILING, projectId, logDate)

  const roster: OutboundRosterEngineer[] = []
  for (const m of members ?? []) {
    const resolved = resolveRosterEngineer((m as { users: unknown }).users)
    if ('unreachable' in resolved) {
      reportUnreachableEngineer(resolved.unreachable, projectId, logDate)
      continue
    }
    roster.push(resolved.engineer)
  }
  return roster
}

/**
 * Morning trigger roster. No `daily_logs` join at all -- there is nothing
 * to read yet at 08:30; today's row, if any, is created BY this trigger's
 * own RPC call (startFlow: true), not read beforehand. Exclusions:
 * `messaging_blocked`, and (see `resolveRosterEngineer`) a missing
 * `whatsapp_number`/`tenant_id`.
 */
export async function fetchMorningRoster(
  client: SupabaseClient,
  projectId: string,
  logDate: string,
): Promise<OutboundRosterEngineer[]> {
  return fetchActiveEngineers(client, projectId, logDate)
}

export interface EveningRosterEngineer extends OutboundRosterEngineer {
  /** daily_logs.morning_plan for today, or null if no row / no plan captured. Feeds templates.ts's own template-variant selection -- NOT a gate. */
  morningPlan: string | null
}

/** What today's daily_logs row (if any) contributes to the evening-roster decision -- deliberately narrow, mirrors lib/checkin-escalations/roster.ts's own TodayLogRow-shaped narrowing. */
export interface EveningTodayLogRow {
  attendance: string | null
  morning_plan: string | null
}

/**
 * Pure filter -- testable without a client, same split as
 * lib/checkin-escalations/roster.ts's own filterDueRoster.
 *
 * HARD REQUIREMENT (design-decisions-beta-feedback.md §37(a), confirmed
 * against §30(b)/(d)): this roster must NOT gate on morning submission.
 * An engineer who missed the morning window entirely may have been on
 * site all day -- the evening trigger asking what happened does not
 * depend on whether he already answered a different, earlier question.
 * The ONLY two exclusions are `messaging_blocked=true` (applied upstream,
 * in fetchActiveEngineers -- an already-excluded engineer never reaches
 * this function at all) and `attendance='site_holiday'` (below,
 * evening-only, since attendance is only known once a daily_logs row
 * exists for today). DO NOT add a `morning_submitted_at IS NOT NULL`
 * filter here, no matter how natural it looks copying
 * `routeInboundMessage`'s shape (`lib/whatsapp/inbound-start.ts`) --
 * that gate is specific to the INBOUND path and is NOT precedent for
 * this query. See §37(b) for the inbound gap this roster must not
 * inherit. See test/unit/outbound-roster.test.ts for the regression test
 * that pins this property directly.
 */
export function filterEveningRoster(
  roster: OutboundRosterEngineer[],
  todayLogsByEngineer: ReadonlyMap<string, EveningTodayLogRow>,
): EveningRosterEngineer[] {
  return roster
    .filter((r) => todayLogsByEngineer.get(r.engineer_id)?.attendance !== 'site_holiday')
    .map((r) => ({ ...r, morningPlan: todayLogsByEngineer.get(r.engineer_id)?.morning_plan ?? null }))
}

/**
 * Evening trigger roster (DB-touching). See filterEveningRoster's own doc
 * for the hard requirement this function must not violate.
 */
export async function fetchEveningRoster(
  client: SupabaseClient,
  projectId: string,
  logDate: string,
): Promise<EveningRosterEngineer[]> {
  const roster = await fetchActiveEngineers(client, projectId, logDate)
  if (roster.length === 0) return []

  const engineerIds = roster.map((r) => r.engineer_id)
  const { data: logs, error } = await client
    .from('daily_logs')
    .select('engineer_id, attendance, morning_plan')
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .in('engineer_id', engineerIds)
  if (error) throw error

  const byEngineer = new Map(
    (logs ?? []).map((l) => [l.engineer_id as string, l as EveningTodayLogRow]),
  )

  return filterEveningRoster(roster, byEngineer)
}

export interface ActiveProject {
  id: string
  tenant_id: string
  name: string
}

/**
 * Every active project, tenant_id and name included so a caller looping
 * over projects (item E's own two cron routes; item F's coverage-sweep
 * expected-roster-size computation) never needs a second query per
 * project just to get its name for the message template or its tenant_id
 * for triggerCheckIn's own params. Same `SELECT ... WHERE status='active'`
 * shape app/api/cron/dpr-generate/route.ts's own trigger already uses --
 * not a new query pattern, just shared rather than duplicated a third
 * time (coverage-sweep.ts used to keep its own private copy of the id-only
 * version; moved here 2026-08-28 so item E's routes reuse the exact same
 * function instead of a fourth copy).
 */
export async function fetchActiveProjects(client: SupabaseClient): Promise<ActiveProject[]> {
  const { data, error } = await client.from('projects').select('id, tenant_id, name').eq('status', 'active')
  if (error) throw error
  return (data ?? []) as ActiveProject[]
}
