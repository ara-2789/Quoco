import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { SessionFlow, WhatsAppSession } from '@/lib/whatsapp/session'
import type { MorningOutcome } from '@/lib/whatsapp/flows/morning'

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

// Morning-flow fixtures. The project uses a fixed UUID; the ENGINEER id is
// DYNAMIC (created per-run via supabase.auth.admin.createUser) because
// public.users.id still FKs auth.users(id) until migration 007 (auth surgery)
// drops it — so a users row cannot exist without a matching auth.users row.
// This is a TEST-ONLY crutch, NOT the production ENG-01 path (PM creates an
// engineer from name+phone only, which only becomes possible post-007).
export const TEST_PROJECT_ID = '00000000-0000-4000-a000-00000000f014'
export const TEST_ENGINEER_EMAIL = 'zz-test-engineer@quoco.test'

// Set by ensureMorningFixtures once the auth user exists; read via testEngineerId().
let engineerId: string | null = null
export function testEngineerId(): string {
  if (!engineerId) {
    throw new Error('testEngineerId() called before ensureMorningFixtures() created the auth user')
  }
  return engineerId
}

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

// The engineer fixture's WhatsApp number (also in the fake phone space).
export const TEST_ENGINEER_PHONE = testPhone('200')

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

// Create (or reuse) the auth.users row the engineer public.users row must point
// at while users_id_fkey -> auth.users still exists (pre-migration-007). Reuses
// an existing test auth user by email so re-runs are idempotent. Returns its id.
async function ensureAuthEngineer(db: SupabaseClient): Promise<string> {
  const { data: list, error: listErr } = await db.auth.admin.listUsers()
  if (listErr) throw new Error(`ensureAuthEngineer listUsers failed: ${listErr.message}`)
  const existing = list.users.find((u) => u.email === TEST_ENGINEER_EMAIL)
  if (existing) return existing.id

  const { data, error } = await db.auth.admin.createUser({
    email: TEST_ENGINEER_EMAIL,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw new Error(`ensureAuthEngineer createUser failed: ${error?.message ?? 'no user returned'}`)
  }
  return data.user.id
}

// Morning-flow fixtures: auth user + tenant + engineer user + project +
// membership. The engineer id is dynamic (see ensureAuthEngineer). Idempotent.
// Call in beforeAll.
export async function ensureMorningFixtures(): Promise<void> {
  const db = testClient()
  await ensureTestTenant()

  engineerId = await ensureAuthEngineer(db)

  const { error: userErr } = await db.from('users').upsert(
    {
      id: engineerId,
      tenant_id: TEST_TENANT_ID,
      full_name: 'ZZ Test Engineer (morning-flow suite)',
      role: 'engineer',
      status: 'active',
      messaging_blocked: false,
      whatsapp_number: TEST_ENGINEER_PHONE,
    },
    { onConflict: 'id' },
  )
  if (userErr) throw new Error(`ensureMorningFixtures user failed: ${userErr.message}`)

  const { error: projErr } = await db.from('projects').upsert(
    {
      id: TEST_PROJECT_ID,
      tenant_id: TEST_TENANT_ID,
      name: 'ZZ Test Project (morning-flow suite)',
    },
    { onConflict: 'id' },
  )
  if (projErr) throw new Error(`ensureMorningFixtures project failed: ${projErr.message}`)

  const { error: memberErr } = await db.from('project_members').upsert(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      user_id: engineerId,
      role: 'engineer',
    },
    { onConflict: 'project_id,user_id' },
  )
  if (memberErr) throw new Error(`ensureMorningFixtures member failed: ${memberErr.message}`)
}

// Delete every daily_logs row this suite could have written. Keyed on the fixed
// test project id, so nothing survives across runs. Call in afterEach.
export async function cleanupTestDailyLogs(): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_ID)
  if (error) throw new Error(`cleanupTestDailyLogs failed: ${error.message}`)
}

// Tear down the morning fixtures in FK-safe order. Call in afterAll. Deletes the
// public.users row and then the backing auth.users row (admin API).
export async function removeMorningFixtures(): Promise<void> {
  const db = testClient()

  await cleanupTestDailyLogs()

  const { error: memberErr } = await db
    .from('project_members')
    .delete()
    .eq('project_id', TEST_PROJECT_ID)
  if (memberErr) throw new Error(`removeMorningFixtures member failed: ${memberErr.message}`)

  await cleanupTestSessions()

  const { error: projErr } = await db.from('projects').delete().eq('id', TEST_PROJECT_ID)
  if (projErr) throw new Error(`removeMorningFixtures project failed: ${projErr.message}`)

  if (engineerId) {
    const { error: userErr } = await db.from('users').delete().eq('id', engineerId)
    if (userErr) throw new Error(`removeMorningFixtures user failed: ${userErr.message}`)

    const { error: authErr } = await db.auth.admin.deleteUser(engineerId)
    if (authErr) throw new Error(`removeMorningFixtures auth deleteUser failed: ${authErr.message}`)

    engineerId = null
  }

  await removeTestTenant()
}

// ---------------------------------------------------------------------------
// RPC wrappers — call the functions under test directly through the test
// client (same call path as lib/whatsapp/*, but against test-db).
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

// Result shape returned by apply_morning_flow_turn (jsonb).
export interface MorningTurnRow {
  outcome: MorningOutcome
  current_flow: SessionFlow | null
  current_step: number
  log_date: string
}

// Wrapper over the single transactional morning-flow RPC. Parameter names match
// apply_morning_flow_turn's SQL signature EXACTLY (p_phone_number, p_tenant_id,
// p_user_id, p_project_id, p_message, p_start_flow, p_now, p_test_sleep_ms) —
// NOT the acquire_and_transition_session names. Engineer/project default to the
// morning fixtures but can be overridden.
export async function applyMorningFlowTurn(params: {
  phone: string
  message: string
  startFlow: boolean
  tenantId?: string
  userId?: string
  projectId?: string
  now?: string
  testSleepMs?: number
}): Promise<MorningTurnRow> {
  const db = testClient()
  const { data, error } = await db.rpc('apply_morning_flow_turn', {
    p_phone_number: params.phone,
    p_tenant_id: params.tenantId ?? TEST_TENANT_ID,
    p_user_id: params.userId ?? testEngineerId(),
    p_project_id: params.projectId ?? TEST_PROJECT_ID,
    p_message: params.message,
    p_start_flow: params.startFlow,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })
  if (error) throw new Error(`apply_morning_flow_turn failed: ${error.message}`)
  return data as MorningTurnRow
}

// ---------------------------------------------------------------------------
// Direct seeding / reading helpers (bypass the RPC to control or inspect state)
// ---------------------------------------------------------------------------

// Directly seed a session row (bypassing the RPC) so a test can control the
// clock — specifically updated_at, the column quoco_same_ist_day compares
// against p_now. Used by the session-transition suite.
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

// Shape of a daily_logs row (only the columns Pass 1 touches; nulls elsewhere).
export interface DailyLogRow {
  project_id: string
  engineer_id: string
  log_date: string
  morning_plan: string | null
  morning_execution_plan: string | null
  morning_submitted_at: string | null
}

// Read the daily_logs row for the fixture engineer/project on a given log_date.
// Returns null if no row exists (e.g. before any answer materialises one).
export async function getDailyLog(logDate: string): Promise<DailyLogRow | null> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .select(
      'project_id, engineer_id, log_date, morning_plan, morning_execution_plan, morning_submitted_at',
    )
    .eq('project_id', TEST_PROJECT_ID)
    .eq('engineer_id', testEngineerId())
    .eq('log_date', logDate)
    .maybeSingle<DailyLogRow>()
  if (error) throw new Error(`getDailyLog failed: ${error.message}`)
  return data ?? null
}

// Read the current session row for a phone (for resume/step assertions).
export async function readSession(phone: string): Promise<WhatsAppSession | null> {
  const db = testClient()
  const { data, error } = await db
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle<WhatsAppSession>()
  if (error) throw new Error(`readSession failed: ${error.message}`)
  return data ?? null
}

// Read the test-only diagnostic timestamp the session function merges into
// context when p_test_sleep_ms is supplied (migration 013). Present only in the
// session-transition suite's Test B rows.
export function lockAcquiredAt(session: WhatsAppSession): number {
  const raw = (session.context as Record<string, unknown>)['_test_lock_acquired_at']
  if (typeof raw !== 'string') {
    throw new Error('_test_lock_acquired_at missing from context — did 013 apply to the branch?')
  }
  return new Date(raw).getTime()
}
