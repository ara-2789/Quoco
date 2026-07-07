import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppSession } from '@/lib/whatsapp/session'

// ---------------------------------------------------------------------------
// Test-db access helpers. These build their OWN Supabase client straight from
// the SUPABASE_TEST_* vars — they deliberately do NOT import
// lib/supabase/service.ts, which reads NEXT_PUBLIC_SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY and could resolve to production. The allowlist
// guard (test/setup/guard.ts) has already proven these vars point at the
// test-db branch before any of this runs.
// ---------------------------------------------------------------------------

// Recognisable, obviously-fake phone space: +1 (999) 555-0XXX.
// 999 is a non-assignable NANP area code and 555-01XX is the fictional range,
// so these can never collide with a real WhatsApp number. Every session row
// this suite creates carries this prefix; cleanup keys on it.
export const TEST_PHONE_PREFIX = '+19995550'

// Fixed, recognisable tenant the sessions hang off (whatsapp_sessions.tenant_id
// is NOT NULL). Deterministic UUID so cleanup/re-runs are idempotent.
export const TEST_TENANT_ID = '00000000-0000-4000-a000-00000000d013'

let cachedClient: SupabaseClient | null = null

export function testClient(): SupabaseClient {
  if (cachedClient) return cachedClient
  cachedClient = createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  return cachedClient
}

// A unique fake number per test. `slot` is a 3-digit string that lands inside
// the fictional +1 999 555-0XXX block.
export function testPhone(slot: string): string {
  return `${TEST_PHONE_PREFIX}${slot}`
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

export async function ensureTestTenant(): Promise<void> {
  const db = testClient()
  const { error } = await db.from('tenants').upsert(
    {
      id: TEST_TENANT_ID,
      name: 'ZZ Test Tenant (session-transition suite)',
      slug: 'zz-test-session-transition',
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`ensureTestTenant failed: ${error.message}`)
}

// Delete every session this suite could have created. Runs in afterEach so the
// branch never accumulates test rows across repeated runs.
export async function cleanupTestSessions(): Promise<void> {
  const db = testClient()
  const { error } = await db
    .from('whatsapp_sessions')
    .delete()
    .like('phone_number', `${TEST_PHONE_PREFIX}%`)
  if (error) throw new Error(`cleanupTestSessions failed: ${error.message}`)
}

export async function removeTestTenant(): Promise<void> {
  const db = testClient()
  const { error } = await db.from('tenants').delete().eq('id', TEST_TENANT_ID)
  if (error) throw new Error(`removeTestTenant failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// RPC wrappers — call the functions under test directly through the test
// client (same call path as lib/whatsapp/session.ts, but against test-db).
// ---------------------------------------------------------------------------

export async function acquireAndTransition(params: {
  phone: string
  requestedFlow: string | null
  caller?: 'webhook' | 'scheduled_trigger'
  now?: string
  testSleepMs?: number
}): Promise<WhatsAppSession> {
  const db = testClient()
  const { data, error } = await db.rpc('acquire_and_transition_session', {
    p_phone_number: params.phone,
    p_tenant_id: TEST_TENANT_ID,
    p_user_id: null,
    p_requested_flow: params.requestedFlow,
    p_caller: params.caller ?? 'webhook',
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })
  if (error) throw new Error(`acquire_and_transition_session failed: ${error.message}`)
  return data as WhatsAppSession
}

export async function drainNextPendingFlow(params: {
  phone: string
  now?: string
}): Promise<WhatsAppSession | null> {
  const db = testClient()
  const { data, error } = await db.rpc('drain_next_pending_flow', {
    p_phone_number: params.phone,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
  })
  if (error) throw new Error(`drain_next_pending_flow failed: ${error.message}`)
  return (data as WhatsAppSession | null) ?? null
}

// Directly seed a session row (bypassing the RPC) so a test can control the
// clock — specifically updated_at, the column quoco_same_ist_day compares
// against p_now. Used by Test C.
export async function seedSession(row: {
  phone: string
  currentFlow: string | null
  currentStep: number
  context: Record<string, unknown>
  pendingFlows?: unknown[]
  updatedAt: string
}): Promise<void> {
  const db = testClient()
  const { error } = await db.from('whatsapp_sessions').insert({
    phone_number: row.phone,
    tenant_id: TEST_TENANT_ID,
    user_id: null,
    current_flow: row.currentFlow,
    current_step: row.currentStep,
    context: row.context,
    pending_flows: row.pendingFlows ?? [],
    updated_at: row.updatedAt,
    // expires_at is irrelevant to the same-day decision (the function keys on
    // updated_at only) but the column has a default; set it alongside for
    // realism.
    expires_at: row.updatedAt,
  })
  if (error) throw new Error(`seedSession failed: ${error.message}`)
}

// Read the test-only diagnostic timestamp the function merges into context when
// p_test_sleep_ms is supplied (migration 013). Present only in Test B rows.
export function lockAcquiredAt(session: WhatsAppSession): number {
  const raw = (session.context as Record<string, unknown>)['_test_lock_acquired_at']
  if (typeof raw !== 'string') {
    throw new Error('_test_lock_acquired_at missing from context — did 013 apply to the branch?')
  }
  return new Date(raw).getTime()
}
