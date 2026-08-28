// Pass 1 item F -- the cron-did-not-fire check (docs/plans/pass1-outbound-
// send-plan.md, Amendment (b), corrected same day and again 2026-08-28).
// Runs inside the EXISTING app/api/jobs/tick cron (F1) -- NOT a new
// vercel.json entry, same placement discipline as B3's own sweep
// (sweepStaleMorningSessions, lib/daily-logs/morning-cutoff-sweep.ts),
// which this module deliberately mirrors in shape: a thin DB-touching
// function, a separate pure/impure split for the alerting half, and
// per-item Sentry dedup via fingerprint.
//
// TWO INDEPENDENT CHECKS, BOTH REQUIRED (031's own STUCK-CLAIM
// RECONCILIATION section -- "they are NOT separable"):
//   1. COVERAGE -- for each checkpoint whose window has closed today,
//      compare the roster's expected size against outbound_sends rows
//      that reached status='sent' (F2 -- never a bare row count; a
//      'sending' or 'failed' row must not read as delivered).
//   2. STUCK-CLAIM SCAN -- rows genuinely abandoned mid-flight
//      (status='sending', updated_at past a 10-minute threshold), so a
//      dead process between the claim INSERT and the terminal UPDATE
//      doesn't sit invisible forever (031's own reasoning, restated at
//      the top of that file).
//
// F3 -- THE MARKER PARTITION, DECIDED (2026-08-28, reported before this
// file was written, per the coordination checkpoint's own instruction).
// Two populations share the bare `status='sending'` signature:
//   - error IS NULL -- a row a 5xx or network exception left ambiguous.
//     Genuinely stuck; nothing else is coming for it. THE stuck-claim scan
//     below (fix (b) in 031's own header).
//   - error = RATE_LIMITED_MARKER -- a row item B's own 429 mechanism
//     marked re-claimable. NOT stuck in the same sense: item E's own retry
//     cadence (still undecided, per Amendment (g)) is what's supposed to
//     clear it, and Amendment (g)'s own text is explicit that a sustained
//     429 backlog during the morning burst is "the STEADY STATE this
//     design was built for, not a rare edge" at this account's 250-
//     conversation/24h tier -- not an occasional spike.
// DECIDED: OPTION (a), excluded entirely from the stuck-claim alert scan.
// Its count is returned as plain data (rateLimitedBacklogCount below), not
// a Sentry call of any kind. ARGUED, not merely chosen: even a distinct
// Sentry fingerprint per (checkpoint, day) still OPENS OR REOPENS AN ISSUE
// on a cadence that will very plausibly recur every single morning once
// the roster is more than a handful of engineers -- which is exactly the
// noise Amendment (g)'s own closing line warns against ("If item F pages
// on benign morning backlog, the first burst teaches everyone to ignore
// the only channel real stuck rows have"). Keeping this population OUT of
// the alert path entirely is what keeps that channel meaning exactly one
// thing: a row nobody is coming back for.
//
// TIME-GATING THE COVERAGE CHECK (not merely COMPUTING it, ALERTING on
// it) -- a decision this file has to make that the stuck-claim scan does
// not. Comparing "roster size" against "sent count" only means something
// once a checkpoint's own send window has had a real chance to finish --
// checking one minute after morningSend (08:30) would find a roster still
// mid-flight and falsely read as a gap. Reuses this project's own already-
// decided cutoff times (lib/daily-logs/cutoffs.ts's CHECKIN_CHECKPOINTS)
// rather than inventing a new threshold: morningCutoff (15:00) for the
// morning checkpoint, eveningClose (19:45) for the evening one -- both
// already mean "this window is now closed" elsewhere in this codebase
// (B3's sweep gates on morningCutoff the same way, inside its own RPC).
// Computed every tick regardless (cheap, and keeps the return value honest
// per B2's own "surfaced in a value nobody reads is not itself a safety
// argument" finding) -- gated is only whether a shortfall becomes a Sentry
// call.

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { istDateString } from '@/lib/daily-logs/date'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { fetchMorningRoster, fetchEveningRoster } from './roster'
import { RATE_LIMITED_MARKER } from './trigger'

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

type Checkpoint = 'morning_send' | 'evening_send'

export interface CoverageCheckpointResult {
  checkpoint: Checkpoint
  logDate: string
  windowClosed: boolean
  expectedRosterSize: number
  sentCount: number
  gap: number
}

export interface StuckClaimRow {
  id: string
  toPhoneNumber: string
  contentSid: string
  updatedAt: string
}

export interface CoverageSweepResult {
  checkpoints: CoverageCheckpointResult[]
  stuckClaims: StuckClaimRow[]
  /** Excluded from the stuck-claim scan and from alerting entirely -- see F3 above. Visibility only. */
  rateLimitedBacklogCount: number
}

/**
 * SET 1 of the coverage check -- active projects, same shape
 * app/api/cron/dpr-generate/route.ts's own runDprGenerateTrigger already
 * uses (`SELECT id, tenant_id FROM projects WHERE status='active'`), not a
 * new pattern.
 */
async function fetchActiveProjectIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from('projects').select('id').eq('status', 'active')
  if (error) throw error
  return (data ?? []).map((p) => p.id as string)
}

/**
 * Global expected-roster-size for one checkpoint, summed across every
 * active project -- NOT tenant- or project-scoped in the result (the plan's
 * own comparison is a flat "expected roster size vs. sent count", per
 * checkpoint per day; see this file's own header). At Pass 1's actual
 * scale (roster.ts's own "today's honest roster is single digits") a
 * single global comparison is what the plan specifies -- per-project
 * granularity is not asked for here and would be scope beyond F1-F4.
 */
async function expectedRosterSize(
  client: SupabaseClient,
  checkpoint: Checkpoint,
  logDate: string,
): Promise<number> {
  const projectIds = await fetchActiveProjectIds(client)
  let total = 0
  for (const projectId of projectIds) {
    const roster =
      checkpoint === 'morning_send'
        ? await fetchMorningRoster(client, projectId, logDate)
        : await fetchEveningRoster(client, projectId, logDate)
    total += roster.length
  }
  return total
}

async function sentCountForEventKey(client: SupabaseClient, eventKey: string): Promise<number> {
  // F2 -- status='sent' explicitly, never a bare row count (031's own
  // corrected fix (a): a claim commits 'sending' BEFORE the Twilio call, so
  // counting all rows for the event_key would count a dead-on-arrival claim
  // as coverage -- the exact gap this check exists to catch).
  const { count, error } = await client
    .from('outbound_sends')
    .select('id', { count: 'exact', head: true })
    .eq('event_key', eventKey)
    .eq('status', 'sent')
  if (error) throw error
  return count ?? 0
}

async function checkCoverageForCheckpoint(
  client: SupabaseClient,
  checkpoint: Checkpoint,
  logDate: string,
  nowMinutes: number,
): Promise<CoverageCheckpointResult> {
  const cutoffMinutes =
    checkpoint === 'morning_send'
      ? hhmmToMinutes(CHECKIN_CHECKPOINTS.morningCutoff)
      : hhmmToMinutes(CHECKIN_CHECKPOINTS.eveningClose)
  const windowClosed = nowMinutes >= cutoffMinutes

  const eventKey = `${checkpoint}:${logDate}`
  const [expected, sent] = await Promise.all([
    expectedRosterSize(client, checkpoint, logDate),
    sentCountForEventKey(client, eventKey),
  ])

  return {
    checkpoint,
    logDate,
    windowClosed,
    expectedRosterSize: expected,
    sentCount: sent,
    gap: Math.max(0, expected - sent),
  }
}

/**
 * F4 -- the stuck-claim scan. F3's partition applied directly in the query:
 * `error IS NULL` excludes the rate-limited backlog structurally, not as a
 * post-filter that could accidentally be dropped by a future edit.
 */
async function fetchStuckClaims(client: SupabaseClient, now: Date): Promise<StuckClaimRow[]> {
  const threshold = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('outbound_sends')
    .select('id, to_phone_number, content_sid, updated_at')
    .eq('status', 'sending')
    .is('error', null)
    .lt('updated_at', threshold)
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    toPhoneNumber: r.to_phone_number as string,
    contentSid: r.content_sid as string,
    updatedAt: r.updated_at as string,
  }))
}

async function fetchRateLimitedBacklogCount(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('outbound_sends')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sending')
    .eq('error', RATE_LIMITED_MARKER)
  if (error) throw error
  return count ?? 0
}

export async function runOutboundCoverageSweep(client: SupabaseClient, now: Date): Promise<CoverageSweepResult> {
  const logDate = istDateString(now)
  const nowMinutes = istParts(now).minutes

  const checkpoints = await Promise.all([
    checkCoverageForCheckpoint(client, 'morning_send', logDate, nowMinutes),
    checkCoverageForCheckpoint(client, 'evening_send', logDate, nowMinutes),
  ])

  const [stuckClaims, rateLimitedBacklogCount] = await Promise.all([
    fetchStuckClaims(client, now),
    fetchRateLimitedBacklogCount(client),
  ])

  return { checkpoints, stuckClaims, rateLimitedBacklogCount }
}

// COVERAGE-GAP ALERTING IS GATED ON ITEM E BEING LIVE -- a hardcoded
// constant, flipped via a deliberate code change + review in the SAME
// commit that adds item E's two vercel.json cron entries, matching this
// codebase's own established "changed via code + review, never a runtime
// knob" discipline (roster.ts's own ROSTER_CARDINALITY_CEILING already
// argues this exact point for a comparable safety-relevant constant --
// not repeated here).
//
// WHY THIS GATE EXISTS, NOT ORIGINALLY ASKED FOR BUT FOUND WHILE BUILDING
// THIS FILE (2026-08-28): app/api/jobs/tick/route.ts is ALREADY LIVE in
// production today -- it fires every 60 seconds regardless of this PR,
// per its own existing vercel.json entry. Item E's own two trigger crons
// -- the ONLY mechanism that will ever populate outbound_sends with real
// rows -- are deliberately WITHHELD pending GATE 1/B3 confirmation (this
// plan's own "Two hard preconditions" section). Without this gate, the
// MOMENT this PR merges, every checkpoint's own coverage check would find
// its full roster size as a "gap" every single day (roster > 0, sentCount
// always 0, since nothing sends yet) and alert past every cutoff,
// forever, until item E ships -- exactly the "first burst teaches
// everyone to ignore the only channel real stuck rows have" hazard
// Amendment (g) already named for the rate-limited case, one level
// earlier and considerably worse (daily, not just during a rate-limit
// burst). The STUCK-CLAIM scan and the coverage COMPUTATION itself
// (checkpoints/gap, still returned below) are deliberately NOT gated --
// both are correctly silent/empty when outbound_sends has no rows at
// all, by construction, so there is nothing to falsely alert on there
// even before item E exists.
// Exported as a real constant (not buried as a bare default value) so the
// production call site (app/api/jobs/tick/route.ts) and this file's own
// test both read the SAME single source of truth, and so flipping it is a
// one-line, reviewable diff when item E ships -- never a magic literal
// duplicated at each call site.
export const OUTBOUND_TRIGGER_CRON_LIVE = false

/**
 * DEDUP, same convention as reportMorningSweepAnomalies (lib/daily-logs/
 * morning-cutoff-sweep.ts): coverage gaps fingerprint on (checkpoint,
 * logDate) so a tick-by-tick re-detection of the SAME day's gap collapses
 * into one growing issue; stuck claims fingerprint on the row's own id (031
 * header's own stated convention -- "fingerprinted on the row's id, same
 * per-item dedup discipline already established for
 * reportMorningSweepAnomalies"), so each dead row is its own issue rather
 * than one undifferentiated alert a human has to unpack. The rate-limited
 * backlog count is NEVER passed to Sentry here -- see F3 above.
 *
 * `triggerCronLive` defaults to the real OUTBOUND_TRIGGER_CRON_LIVE
 * constant -- injectable so this file's own test can exercise the
 * alerting path (pass `true`) independently of proving the PRODUCTION
 * default is actually off (call with no second argument at all).
 */
export function reportOutboundCoverageAnomalies(
  result: CoverageSweepResult,
  triggerCronLive: boolean = OUTBOUND_TRIGGER_CRON_LIVE,
): void {
  for (const c of result.checkpoints) {
    if (!triggerCronLive || !c.windowClosed || c.gap <= 0) continue
    Sentry.captureMessage('outbound-send: checkpoint coverage gap after window close', {
      level: 'error',
      fingerprint: ['outbound-send', 'coverage_gap', c.checkpoint, c.logDate],
      tags: { feature: 'outbound-send', checkpoint: c.checkpoint },
      extra: {
        log_date: c.logDate,
        expected_roster_size: c.expectedRosterSize,
        sent_count: c.sentCount,
        gap: c.gap,
      },
    })
  }

  for (const row of result.stuckClaims) {
    Sentry.captureMessage('outbound-send: claim stuck at "sending" past the 10-minute threshold', {
      level: 'error',
      fingerprint: ['outbound-send', 'stuck_claim', row.id],
      tags: { feature: 'outbound-send' },
      extra: {
        claim_id: row.id,
        to_phone_number: row.toPhoneNumber,
        content_sid: row.contentSid,
        updated_at: row.updatedAt,
      },
    })
  }
}

/**
 * Third leg, same shape as reportMorningSweepError -- extracted so the
 * Sentry call is directly unit-testable without a full tick-route harness.
 */
export function reportOutboundCoverageSweepError(err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : String(err)
  Sentry.captureException(err instanceof Error ? err : new Error(message), {
    tags: { feature: 'outbound-send-coverage-sweep' },
  })
  return { error: message }
}
