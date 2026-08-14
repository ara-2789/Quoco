// WhatsApp 24-hour customer-service-window check. PURE calc + thin IO.
//
// NO CONSUMER IN THIS SLICE. Built because the task asked for it, and because
// a future sender slice needs it (to decide free-form vs template fallback,
// per bot-flows.md's 2026-08-12 TRIGGER TIMES correction) — but nothing in
// lib/checkin-escalations/sweep.ts calls fetchSessionWindows or
// determineReachability today, and this slice's status decision
// (status.ts's determineTargetStatus) does not consult reachability at all.
// Do not assume this is wired into the sweep just because the module exists
// — it is deliberately standalone, ready for the sender slice to import.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReachabilityResult {
  windowOpen: boolean
  windowClosesAt: string | null
}

export function determineReachability(sessionUpdatedAt: string | null, now: Date): ReachabilityResult {
  if (!sessionUpdatedAt) return { windowOpen: false, windowClosesAt: null }
  const closesAt = new Date(new Date(sessionUpdatedAt).getTime() + 24 * 60 * 60 * 1000)
  return { windowOpen: now.getTime() < closesAt.getTime(), windowClosesAt: closesAt.toISOString() }
}

/**
 * Join is users.whatsapp_number = whatsapp_sessions.phone_number, by value —
 * not a PostgREST embed (no declared FK between these two columns; the FK
 * that DOES exist, whatsapp_sessions.user_id -> users.id, is not what this
 * uses, since phone_number/whatsapp_number — both independently UNIQUE
 * (uq_whatsapp_sessions_phone_number, users_whatsapp_number_key) — are the
 * more authoritative identity for "is this number reachable" than a
 * user_id FK that isn't guaranteed populated on every session row).
 *
 * Both sides of this join are already unique-indexed (checked via
 * pg_indexes, 2026-08-13) — no index gap exists for this to need filling
 * later; the "do not add an index" instruction this module was built under
 * turned out to already be satisfied structurally.
 */
export async function fetchSessionWindows(client: SupabaseClient, whatsappNumbers: string[]): Promise<Map<string, string>> {
  if (whatsappNumbers.length === 0) return new Map()
  const { data, error } = await client.from('whatsapp_sessions').select('phone_number, updated_at').in('phone_number', whatsappNumbers)
  if (error) throw error
  return new Map((data ?? []).map((s) => [s.phone_number as string, s.updated_at as string]))
}
