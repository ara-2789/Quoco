// Pass 1 item E -- the two trigger crons, shared implementation. Both
// app/api/cron/morning-trigger/route.ts and app/api/cron/evening-
// trigger/route.ts are thin wrappers around runCheckpointTrigger below,
// same thin-route/thick-lib split this codebase already uses for
// runJobsTick (app/api/jobs/tick/route.ts) and runDprGenerateTrigger
// (app/api/cron/dpr-generate/route.ts) -- not a new pattern.
//
// ORDERING: SELECT id, tenant_id, name FROM active projects (roster.ts's
// own fetchActiveProjects) -> per project, fetch the checkpoint's roster
// (fetchMorningRoster/fetchEveningRoster, already correct and tested --
// see roster.ts's own header for why the evening roster must never gate
// on morning submission) -> per engineer, SEQUENTIALLY (not concurrent --
// this project's own standing rule, CLAUDE.md §0's "concurrency/lock/race
// verification is CI-only," argues against relying on unverified
// concurrent behaviour in this sandbox; a roster of "today's honest...
// single digits" per roster.ts's own comment has no throughput reason to
// need concurrency either) -- call triggerCheckIn with the retry budget
// below.
//
// THE RETRY BUDGET -- DECIDED (Aravind, 2026-08-28, docs/plans/pass1-
// outbound-send-plan.md's own Amendment (g) resolution). 3 attempts, per
// engineer, per checkpoint, per IST day. On exhaustion: stop retrying,
// leave the ledger row exactly where triggerCheckIn's own 429 branch left
// it (status='sending', error=RATE_LIMITED_MARKER -- still technically
// re-claimable by a FUTURE invocation of this same route on a LATER day's
// event_key, never today's again), and raise a LOUD Sentry alert naming
// the engineer, phone, and checkpoint so a human can send manually. At
// three engineers a manual fallback is realistic; the alert is written to
// be acted on, not filed.
//
// WHY THE THREE ATTEMPTS HAPPEN INSIDE ONE INVOCATION, NOT ACROSS
// SEPARATE CRON TICKS. Item E's own two cron entries fire ONCE per
// checkpoint per day (08:30 IST, 18:30 IST -- plan's own Scope recap),
// not on a repeating tick like jobs/tick. "3 attempts... per IST day"
// therefore has to be spent within this one invocation, with a short
// backoff between attempts, or the budget could never be exercised at
// all on a single-fire-per-day cron. RETRY_BACKOFF_MS is a judgement
// call, not verified against Twilio's own documented rate-limit window
// (this file's own item-2-adjacent research found no confirmed number to
// verify against) -- short enough that three attempts for the whole
// roster stays well inside Vercel's 60s function timeout at today's
// actual scale (a handful of engineers), long enough to give a
// per-second/burst throttle (this account's own likely 429 cause, per
// the same research) a real chance to clear between attempts. NOT
// verified to hold at the roster cardinality ceiling (50, roster.ts's own
// ROSTER_CARDINALITY_CEILING) -- named as a real scale caveat, not solved
// here; today's actual roster makes it moot.
//
// NO ERROR-CODE BRANCH. The retry-budget decision was conditional on
// whether Twilio/Meta distinguish per-second throttling from daily
// 250-conversation-tier exhaustion by error code (which would call for
// stopping on the FIRST such 429, not the third). That check resolved
// inconclusive -- no code could be confirmed as what this integration
// actually returns -- so every 429 is treated identically here, uniform
// 3-attempt budget, regardless of cause. See docs/plans/pass1-outbound-
// send-plan.md's own Amendment (g) resolution for the full research.

// KNOWN GAP: SupabaseClient here is bare, not SupabaseClient<Database> --
// every query in this file is unchecked against the real schema. See
// docs/reviews/outbound-untyped-supabase-client-gap.md for what it would
// take to close (not a one-line fix -- expect real errors to surface).
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import {
  fetchActiveProjects,
  fetchMorningRoster,
  fetchEveningRoster,
  type OutboundRosterEngineer,
  type EveningRosterEngineer,
} from './roster'
import { triggerCheckIn, type Checkpoint, type TriggerOutcome } from './trigger'

export const MAX_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface EngineerTriggerResult {
  engineerId: string
  whatsappNumber: string
  projectId: string
  attempts: number
  outcome: TriggerOutcome
}

export interface CheckpointTriggerSummary {
  checkpoint: Checkpoint
  logDate: string
  results: EngineerTriggerResult[]
}

/**
 * One engineer, one checkpoint, up to MAX_ATTEMPTS. Retries ONLY on
 * 'rate_limited' -- every other outcome (sent/failed/ambiguous/
 * already_claimed) is terminal-for-today by trigger.ts's own design
 * (031's own STUCK-CLAIM RECONCILIATION section: retrying an ambiguous
 * 5xx/network failure blind is REJECTED there, not merely undecided --
 * this function must not widen that). Returns the LAST outcome and how
 * many attempts it took.
 *
 * `triggerFn`/`sleepFn` injectable, defaulting to the real triggerCheckIn/
 * sleep -- same DI shape as every other real-vs-test seam in this
 * codebase (supabaseClient, fetchFn) -- so this file's own test can
 * exercise the 3-attempt budget and backoff-call-count against a fake
 * trigger function, deterministically, without real Twilio calls, a real
 * DB, or real multi-second waits between attempts.
 */
export async function triggerWithRetryBudget(
  params: Parameters<typeof triggerCheckIn>[0],
  triggerFn: typeof triggerCheckIn = triggerCheckIn,
  sleepFn: typeof sleep = sleep,
): Promise<{ outcome: TriggerOutcome; attempts: number }> {
  let outcome: TriggerOutcome = { outcome: 'already_claimed' }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    outcome = await triggerFn(params)
    if (outcome.outcome !== 'rate_limited') {
      return { outcome, attempts: attempt }
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleepFn(RETRY_BACKOFF_MS)
    }
  }
  return { outcome, attempts: MAX_ATTEMPTS }
}

/**
 * DEDUP per (checkpoint, engineer, IST day) -- same convention as every
 * other outbound-send Sentry call (trigger.ts's own six call sites). This
 * is the loudest of them: 'error' level, and the ONE alert in this whole
 * pass explicitly written to be actioned by a human sending a message by
 * hand, not merely investigated.
 */
export function reportRetryBudgetExhausted(
  engineerId: string,
  whatsappNumber: string,
  checkpoint: Checkpoint,
  logDate: string,
): void {
  Sentry.captureMessage(
    'outbound-send: retry budget exhausted -- engineer received NOTHING today, send manually',
    {
      level: 'error',
      fingerprint: ['outbound-send', 'retry_budget_exhausted', checkpoint, engineerId, logDate],
      tags: { feature: 'outbound-send', checkpoint },
      extra: {
        engineer_id: engineerId,
        whatsapp_number: whatsappNumber,
        checkpoint,
        log_date: logDate,
        max_attempts: MAX_ATTEMPTS,
        action_required: `Send the ${checkpoint} check-in template to ${whatsappNumber} manually -- this engineer's automatic send exhausted its retry budget and nothing else will retry it today.`,
      },
    },
  )
}

async function triggerForEngineer(
  client: SupabaseClient,
  checkpoint: Checkpoint,
  logDate: string,
  engineer: OutboundRosterEngineer,
  project: { id: string; tenant_id: string; name: string },
  morningPlan: string | null,
  fetchFn?: typeof fetch,
): Promise<EngineerTriggerResult> {
  const { outcome, attempts } = await triggerWithRetryBudget({
    checkpoint,
    tenantId: engineer.tenant_id,
    projectId: project.id,
    engineerId: engineer.engineer_id,
    engineerName: engineer.engineer_name,
    projectName: project.name,
    whatsappNumber: engineer.whatsapp_number,
    logDate,
    ...(checkpoint === 'evening_send' ? { morningPlan } : {}),
    supabaseClient: client,
    ...(fetchFn ? { fetchFn } : {}),
  })

  if (outcome.outcome === 'rate_limited' && attempts >= MAX_ATTEMPTS) {
    reportRetryBudgetExhausted(engineer.engineer_id, engineer.whatsapp_number, checkpoint, logDate)
  }

  return {
    engineerId: engineer.engineer_id,
    whatsappNumber: engineer.whatsapp_number,
    projectId: project.id,
    attempts,
    outcome,
  }
}

/**
 * `fetchFn` -- injectable, defaulting to undefined (triggerCheckIn's own
 * default of global `fetch`) when omitted, same DI shape as trigger.ts's
 * own send.ts seam. Threaded all the way down so a test can inject a mock
 * here instead of at the (real, DB-touching) route level -- without this,
 * an integration test exercising this function for real would attempt a
 * genuine HTTP POST to Twilio's real API using whatever fake credentials
 * .env.test happens to carry.
 *
 * NOT COVERED BY A FULL REAL-TEST-DB INTEGRATION TEST -- named honestly,
 * not silently skipped. fetchActiveProjects (roster.ts) reads EVERY
 * active project in test-db, not only a suite's own fixture -- unlike
 * coverage-sweep.ts's own identical fan-out (read-only, safe), this
 * function WRITES: it claims, activates sessions for, and permanently
 * ledgers (outbound_sends, no DELETE grant) every roster member of EVERY
 * active project, for whatever logDate is passed in. Running this for
 * real against the shared test-db would attempt to claim/activate a
 * session for OTHER test suites' own fixture engineers under this
 * function's own test date -- a genuine cross-suite side effect, not a
 * hypothetical one, and a worse category than coverage-sweep.ts's own
 * "shared, uncontrolled state" caveat (that one only reads; this one
 * writes, permanently, to state this suite does not own). Covered
 * instead by its own pieces, each independently tested: roster.ts's own
 * fetchMorningRoster/fetchEveningRoster (test/unit/outbound-roster.test.ts),
 * trigger.ts's own triggerCheckIn (test/outbound-trigger.test.ts), and
 * this file's own triggerWithRetryBudget/reportRetryBudgetExhausted
 * (test/unit/outbound-checkpoint-trigger.test.ts, pure, no DB).
 */
export async function runCheckpointTrigger(
  client: SupabaseClient,
  checkpoint: Checkpoint,
  logDate: string,
  fetchFn?: typeof fetch,
): Promise<CheckpointTriggerSummary> {
  const projects = await fetchActiveProjects(client)
  const results: EngineerTriggerResult[] = []

  for (const project of projects) {
    const roster =
      checkpoint === 'morning_send'
        ? await fetchMorningRoster(client, project.id, logDate)
        : await fetchEveningRoster(client, project.id, logDate)

    for (const engineer of roster) {
      const morningPlan = checkpoint === 'evening_send' ? (engineer as EveningRosterEngineer).morningPlan : null
      // Sequential, deliberately -- see this file's own header.
      const result = await triggerForEngineer(client, checkpoint, logDate, engineer, project, morningPlan)
      results.push(result)
    }
  }

  return { checkpoint, logDate, results }
}
