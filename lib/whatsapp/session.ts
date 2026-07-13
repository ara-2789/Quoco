import { createServiceClient } from '@/lib/supabase/service'

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
