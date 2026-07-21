import type { SupabaseClient } from '@supabase/supabase-js'

// BOT-27 reactivation — the CLEAR half only (opt-in re-send is deferred, blocked
// on the Twilio production sender — see docs/bot-flows.md BOT-27 / CLAUDE.md §10).
//
// This module follows the repo's pure-decision + thin-IO split (mirrors
// dispatchMorningFlow / applyMorningFlowTurn in lib/whatsapp/flows/morning.ts):
// decideInboundGate() is a pure function unit-tested without HTTP; the DB write
// lives in clearMessagingBlock().
//
// SECURITY (BOT-08 gate): the ONLY inbound that clears a block is one from an
// engineer gated SOLELY by messaging_blocked (status still 'active'). A non-active
// status (pending / deactivated) stays gated regardless of the flag — a
// deactivated engineer must NEVER be silently reactivated by texting in.

// The subset of the users gate-row this decision reads (matches the webhook's
// GateUser lookup: status + messaging_blocked).
export interface GateDecisionUser {
  status: string
  messaging_blocked: boolean
}

// - 'reactivate'  → active engineer gated only by the block: clear it, ack, stop.
// - 'gated_noop'  → still gated (pending / deactivated, any flag value): silent
//                   no-op, no write, no disclosure (existing behaviour).
// - 'proceed'     → active + unblocked: fall through to the normal flow.
export type InboundGate = 'reactivate' | 'gated_noop' | 'proceed'

export function decideInboundGate(user: GateDecisionUser): InboundGate {
  if (user.status !== 'active') {
    // Pending or deactivated: gated regardless of messaging_blocked. Crucially,
    // a deactivated+blocked engineer is NOT reactivated here.
    return 'gated_noop'
  }
  // status === 'active' below.
  if (user.messaging_blocked) {
    return 'reactivate'
  }
  return 'proceed'
}

// Atomically clear the block for an active engineer (single-row, single-column
// UPDATE — no transaction needed). Scoped by BOTH id and tenant_id defensively.
// The caller passes the service client already in use by the webhook.
export async function clearMessagingBlock(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('users')
    .update({ messaging_blocked: false })
    .eq('id', userId)
    .eq('tenant_id', tenantId)
  return { error: error ? error.message : null }
}
