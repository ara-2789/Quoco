import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { istDateString } from '@/lib/daily-logs/date'

// Flow types allowed on whatsapp_sessions.current_flow (migration 001 CHECK).
export type SessionFlow = 'morning' | 'evening' | 'safety' | 'invoice' | 'hindrance'

// Who is driving the transition. Today only the webhook. Cron trigger routes
// ('scheduled_trigger') do not exist yet — the priority classification in the
// SQL function already accounts for them (BOT-26) for when they land.
export type SessionCaller = 'webhook' | 'scheduled_trigger'

// A flow waiting behind the active one (BOT-21/BOT-26). Shape {type, priority,
// queued_at}; drained in (priority, queued_at) order.
export interface PendingFlow {
  type: string
  priority: number
  queued_at: string
}

// Mirrors the whatsapp_sessions row returned by the SQL functions.
export interface WhatsAppSession {
  id: string
  created_at: string
  tenant_id: string
  user_id: string | null
  phone_number: string
  current_flow: SessionFlow | null
  current_step: number
  context: Record<string, unknown>
  pending_flows: PendingFlow[]
  expires_at: string
  updated_at: string
}

/**
 * UNLOCKED read of current_flow for a phone number — used ONLY by
 * dispatch.ts to pick which RPC to try FIRST. Migration 022's own header
 * documents why an unlocked read here is safe: the RPC that actually gets
 * called re-reads the session UNDER THE LOCK before writing anything, so a
 * stale read here can mis-ROUTE a turn but can never write wrong data.
 * Returns null when no session row exists yet, or current_flow is null
 * (idle) — dispatch.ts treats both the same way (default to morning).
 */
export async function readCurrentFlow(
  phoneNumber: string,
  /**
   * Injected client, defaulting to createServiceClient() (today's exact
   * behaviour) when omitted — same shape as clearMessagingBlock's own
   * client parameter (lib/whatsapp/reactivation.ts).
   */
  supabaseClient?: SupabaseClient,
): Promise<SessionFlow | null> {
  const supabase = supabaseClient ?? createServiceClient()

  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .select('current_flow')
    .eq('phone_number', phoneNumber)
    .maybeSingle<{ current_flow: SessionFlow | null }>()

  if (error) {
    throw new Error(`readCurrentFlow failed for ${phoneNumber}: ${error.message}`)
  }

  return data?.current_flow ?? null
}

/**
 * What routeInboundMessage needs to know about a phone's session row, from ONE
 * select (PR-C C3, docs/plans/pr-c-plan.md section 3c; replaces the old
 * readActiveFlowForRouting, which selected only current_flow + updated_at).
 *
 * `currentFlow` is the RAW value, even when the row is from a previous IST
 * day. `dayStale` carries that comparison separately so the router can still
 * see a day-stale 'invoice' row (it must be cleared, not silently ignored: see
 * the D1(d) design, plan section 3f). For every other flow a day-stale row is
 * treated as NOT active, exactly as before: it falls through to the ordinary
 * idle path instead of being reset by the RPC's own BOT-07 handling (which
 * replies with empty TwiML on a next-day reset — see fix/stale-flow-next-day).
 * The day comparison matches quoco_same_ist_day's Asia/Kolkata semantics
 * (012_whatsapp_session_transition.sql:57-63) via istDateString.
 */
export interface RoutingState {
  currentFlow: SessionFlow | null
  /** true when the row's updated_at is on a different IST calendar day than `now` */
  dayStale: boolean
  expiresAt: string | null
  context: Record<string, unknown>
}

export async function readRoutingState(
  phoneNumber: string,
  now: Date,
  supabaseClient?: SupabaseClient,
): Promise<RoutingState> {
  const supabase = supabaseClient ?? createServiceClient()

  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .select('current_flow, updated_at, expires_at, context')
    .eq('phone_number', phoneNumber)
    .maybeSingle<{
      current_flow: SessionFlow | null
      updated_at: string
      expires_at?: string | null
      context?: Record<string, unknown> | null
    }>()

  if (error) {
    throw new Error(`readRoutingState failed for ${phoneNumber}: ${error.message}`)
  }

  if (!data || data.current_flow === null) {
    return { currentFlow: null, dayStale: false, expiresAt: null, context: {} }
  }
  return {
    currentFlow: data.current_flow,
    dayStale: istDateString(now) !== istDateString(new Date(data.updated_at)),
    expiresAt: data.expires_at ?? null,
    context: data.context ?? {},
  }
}

/**
 * The ONE place a SessionFlow becomes a check-in flow. Exhaustive over all
 * five values with a `never` check, so a sixth SessionFlow fails `tsc` here
 * instead of silently collapsing to 'morning' (the old behaviour at
 * inbound-start.ts's and dispatch.ts's own ternaries). 'safety' and 'invoice'
 * are not check-in flows: null.
 */
export function mapSessionFlowToCheckinFlow(flow: SessionFlow): 'morning' | 'evening' | 'hindrance' | null {
  switch (flow) {
    case 'morning':
      return 'morning'
    case 'evening':
      return 'evening'
    case 'hindrance':
      return 'hindrance'
    case 'safety':
    case 'invoice':
      return null
    default: {
      const unmapped: never = flow
      throw new Error(`mapSessionFlowToCheckinFlow: unmapped session flow ${String(unmapped)}`)
    }
  }
}

/**
 * Clear an expired 'invoice' (material-inward) session BEFORE any other flow
 * function sees the row — any other flow's turn over an 'invoice' row would
 * persist expires_at = p_now + 30 min, reviving it (plan section 3c). Wraps
 * migration 050's expire_stale_material_inward (service_role only): true only
 * when it cleared an 'invoice' row with expires_at <= asOf; false for every
 * other row. Subtract-only, re-checked under the row lock.
 */
export async function expireStaleMaterialInward(
  phoneNumber: string,
  asOf: Date,
  supabaseClient?: SupabaseClient,
): Promise<boolean> {
  const supabase = supabaseClient ?? createServiceClient()
  const { data, error } = await supabase.rpc('expire_stale_material_inward', {
    p_phone_number: phoneNumber,
    p_now: asOf.toISOString(),
  })
  if (error) {
    throw new Error(`expire_stale_material_inward failed for ${phoneNumber}: ${error.message}`)
  }
  return data === true
}

/**
 * Atomically acquire the session row for a phone number and apply the BOT-07 /
 * BOT-21 transition, all inside ONE database transaction (a single Postgres
 * function — NOT multiple client calls, which would drop the row lock between
 * steps). Returns the session's post-transition state.
 *
 * - requestedFlow = null  -> advance whatever flow is active (inbound reply).
 * - requestedFlow = a flow -> start it, unless a different flow is already
 *   active mid-day, in which case it is queued into pending_flows (BOT-21).
 */
export async function acquireAndTransition(params: {
  phoneNumber: string
  tenantId: string
  userId: string | null
  requestedFlow: SessionFlow | null
  caller: SessionCaller
  now?: string
  /** TEST-ONLY: forces a mid-transaction pause to prove the row lock holds. */
  testSleepMs?: number
}): Promise<WhatsAppSession> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('acquire_and_transition_session', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    // gen types marks these args non-null, but the DB function accepts null by
    // design (userId null for an unregistered sender; requestedFlow null =
    // "advance the active flow"). Cast until RPC arg typing is migrated.
    p_user_id: params.userId as string,
    p_requested_flow: params.requestedFlow as SessionFlow,
    p_caller: params.caller,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })

  if (error) {
    throw new Error(
      `acquire_and_transition_session failed for ${params.phoneNumber}: ${error.message}`,
    )
  }

  // gen types now types .rpc() returns as Json, which doesn't structurally
  // overlap the app-level WhatsAppSession (PendingFlow[] etc.). Cast through
  // unknown for now — proper RPC return typing is deferred to the incremental
  // call-site migration (no RPC plumbing this hour).
  return data as unknown as WhatsAppSession
}

/**
 * Stage 3 (migration 045, ~~HELD -- see docs/reviews/045-review-brief.md --
 * not applied to any database yet~~ -- DATED CORRECTION 2026-10-01: applied
 * to both test-db and prod 2026-09-15, see
 * docs/reviews/045-test-db-apply-record.md and
 * docs/reviews/045-prod-apply-record.md). Throttle for the idle-photo nudge: true
 * the first time this is called for a phone number within
 * windowSeconds, or the first time again after that window has elapsed;
 * false for every call inside it. Same acquire-and-lock shape as
 * acquireAndTransition above -- one RPC call, one transaction, so a burst of
 * concurrent photos from the same phone number cannot both observe "no nudge
 * yet" and both claim it.
 */
export async function claimMediaNudge(params: {
  phoneNumber: string
  tenantId: string
  userId: string | null
  windowSeconds: number
  now?: string
  supabaseClient?: SupabaseClient
}): Promise<boolean> {
  const supabase = params.supabaseClient ?? createServiceClient()

  const { data, error } = await supabase.rpc('claim_media_nudge', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    // gen types would mark this non-null; the DB function accepts NULL by
    // design (an unregistered sender never reaches this path today, but the
    // acquire step mirrors acquire_and_transition_session's own nullable
    // p_user_id regardless). Cast until RPC arg typing is migrated -- same
    // pattern as p_requested_flow above.
    p_user_id: params.userId as string,
    p_window_seconds: params.windowSeconds,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
  })

  if (error) {
    throw new Error(`claim_media_nudge failed for ${params.phoneNumber}: ${error.message}`)
  }

  return data as unknown as boolean
}

/**
 * Promote the next queued flow when the active flow completes (BOT-26). Drain
 * order is (priority, queued_at) ascending. Draining an empty queue is a safe
 * no-op that returns the row unchanged. Returns null if no session row exists.
 */
export async function drainNextPendingFlow(params: {
  phoneNumber: string
  now?: string
}): Promise<WhatsAppSession | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('drain_next_pending_flow', {
    p_phone_number: params.phoneNumber,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
  })

  if (error) {
    throw new Error(`drain_next_pending_flow failed for ${params.phoneNumber}: ${error.message}`)
  }

  // Cast through unknown — see the note in acquireAndTransition; proper RPC
  // return typing is deferred to the incremental call-site migration.
  return (data as unknown as WhatsAppSession | null) ?? null
}
