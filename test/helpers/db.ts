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

// Morning-flow fixtures. The project uses a fixed UUID; the ENGINEER id is the
// generated public.users id, captured at insert time. Post-007 the engineer is
// created the REAL ENG-01 way — a plain users INSERT with auth_id = NULL, a
// generated id, and NO auth.users entry (a WhatsApp user simply is not an auth
// user). The pre-007 auth.admin.createUser() crutch is GONE: 007 dropped
// users_id_fkey, so a users row no longer needs a backing auth.users row.
export const TEST_PROJECT_ID = '00000000-0000-4000-a000-00000000f014'

// Set by ensureMorningFixtures once the engineer row exists; read via testEngineerId().
let engineerId: string | null = null
export function testEngineerId(): string {
  if (!engineerId) {
    throw new Error('testEngineerId() called before ensureMorningFixtures() created the engineer row')
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

// Create (or reuse) the engineer public.users row the REAL ENG-01 way: a plain
// INSERT with auth_id = NULL and a generated id, no auth.users entry — only
// possible post-007, which dropped users_id_fkey. Idempotent on the unique
// whatsapp_number (users has no email column to key on). Returns the users id.
async function ensureMorningEngineer(db: SupabaseClient): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from('users')
    .select('id')
    .eq('whatsapp_number', TEST_ENGINEER_PHONE)
    .maybeSingle<{ id: string }>()
  if (selErr) throw new Error(`ensureMorningEngineer select failed: ${selErr.message}`)
  if (existing) return existing.id

  const { data: ins, error } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_ID,
      full_name: 'ZZ Test Engineer (morning-flow suite)',
      role: 'engineer',
      status: 'active',
      messaging_blocked: false,
      whatsapp_number: TEST_ENGINEER_PHONE,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !ins) {
    throw new Error(`ensureMorningEngineer insert failed: ${error?.message ?? 'no row returned'}`)
  }
  return ins.id
}

// Morning-flow fixtures: tenant + engineer user (ENG-01 shape) + project +
// membership. The engineer id is the generated profile id (see
// ensureMorningEngineer). Idempotent. Call in beforeAll.
export async function ensureMorningFixtures(): Promise<void> {
  const db = testClient()
  await ensureTestTenant()

  engineerId = await ensureMorningEngineer(db)

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

// Tear down the morning fixtures in FK-safe order. Call in afterAll. Post-007
// the engineer has NO auth.users entry (auth_id = NULL), so there is no auth row
// to delete — just the public.users row.
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

// ===========================================================================
// Migration 007 (auth surgery) — two-tenant, JWT-scoped test harness.
//
// The helpers above use the SERVICE-ROLE client, which BYPASSES RLS. That is
// fine for seeding/cleanup, but an RLS isolation test run as service role is
// green by definition and proves nothing (review §6). So 007's tests need
// clients authenticated as REAL users with real session JWTs. We obtain those
// by giving throwaway test auth users a password (branch-only — prod stays
// magic-link-only) and calling signInWithPassword against an ANON-key client.
//
// Post-007, creating an auth user fires on_auth_user_created -> handle_new_user,
// which inserts a public.users stub (generated id, auth_id = NEW.id). The
// fixture then CLAIMS that stub (update by auth_id) into a tenant + role.
// ===========================================================================

// Two tenants for the isolation test. Distinct from TEST_TENANT_ID so the 007
// suite never collides with the morning/session fixtures.
export const TEST_TENANT_A_ID = '00000000-0000-4000-a000-0000000007a0'
export const TEST_TENANT_B_ID = '00000000-0000-4000-a000-0000000007b0'
export const TEST_PROJECT_A_ID = '00000000-0000-4000-a000-0000000007a1'
export const TEST_PROJECT_B_ID = '00000000-0000-4000-a000-0000000007b1'

export const TEST_007_USER_A_EMAIL = 'zz-007-user-a@quoco.test'
export const TEST_007_USER_B_EMAIL = 'zz-007-user-b@quoco.test'
// Throwaway password used ONLY to mint session JWTs for these branch-only test
// users. Never a production credential; prod auth is magic-link email only.
export const TEST_007_PASSWORD = 'zz-007-Rehearsal-Pw-9f3c'

export interface TwoTenantFixtures {
  authUserAId: string
  authUserBId: string
  profileAId: string
  profileBId: string
}

// Build a fresh ANON-key client and sign in as the given user, returning a
// client whose requests carry that user's JWT (so RLS actually applies).
export async function jwtClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`jwtClient signIn (${email}) failed: ${error.message}`)
  return client
}

// Idempotently ensure an auth user with a known password exists; returns its id.
// listUsers with a generous page so branch reuse can find the existing row.
async function ensureAuthUser(
  db: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data: list, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) throw new Error(`ensureAuthUser listUsers failed: ${listErr.message}`)

  const existing = list.users.find((u) => u.email === email)
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (error) throw new Error(`ensureAuthUser updateUserById (${email}) failed: ${error.message}`)
    return existing.id
  }

  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) {
    throw new Error(`ensureAuthUser createUser (${email}) failed: ${error?.message ?? 'no user'}`)
  }
  return data.user.id
}

// Claim the trigger-created public.users stub for authUserId into a tenant/role.
// Update-by-auth_id if the stub exists (the normal post-007 path); otherwise
// insert one (defensive — e.g. if a prior run deleted the stub but not the auth
// user). Returns the users.id (which is decoupled from authUserId post-007).
async function claimProfile(
  db: SupabaseClient,
  authUserId: string,
  tenantId: string,
  role: string,
  fullName: string,
): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from('users')
    .select('id')
    .eq('auth_id', authUserId)
    .maybeSingle<{ id: string }>()
  if (selErr) throw new Error(`claimProfile select failed: ${selErr.message}`)

  if (existing) {
    const { error } = await db
      .from('users')
      .update({ tenant_id: tenantId, role, full_name: fullName })
      .eq('auth_id', authUserId)
    if (error) throw new Error(`claimProfile update failed: ${error.message}`)
    return existing.id
  }

  const { data: ins, error } = await db
    .from('users')
    .insert({ auth_id: authUserId, tenant_id: tenantId, role, full_name: fullName })
    .select('id')
    .single<{ id: string }>()
  if (error || !ins) throw new Error(`claimProfile insert failed: ${error?.message ?? 'no row'}`)
  return ins.id
}

// Create two tenants, two JWT-capable users (one per tenant), and one project
// per tenant (created_by that tenant's user) for the RLS isolation read.
// Idempotent. Call in beforeAll.
export async function ensureTwoTenantFixtures(): Promise<TwoTenantFixtures> {
  const db = testClient()

  for (const [id, slug, name] of [
    [TEST_TENANT_A_ID, 'zz-007-tenant-a', 'ZZ 007 Tenant A'],
    [TEST_TENANT_B_ID, 'zz-007-tenant-b', 'ZZ 007 Tenant B'],
  ] as const) {
    const { error } = await db.from('tenants').upsert({ id, slug, name }, { onConflict: 'id' })
    if (error) throw new Error(`ensureTwoTenantFixtures tenant ${slug} failed: ${error.message}`)
  }

  const authUserAId = await ensureAuthUser(db, TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
  const authUserBId = await ensureAuthUser(db, TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)

  const profileAId = await claimProfile(db, authUserAId, TEST_TENANT_A_ID, 'admin', 'ZZ 007 User A')
  const profileBId = await claimProfile(db, authUserBId, TEST_TENANT_B_ID, 'admin', 'ZZ 007 User B')

  for (const [id, tenantId, createdBy, name] of [
    [TEST_PROJECT_A_ID, TEST_TENANT_A_ID, profileAId, 'ZZ 007 Project A'],
    [TEST_PROJECT_B_ID, TEST_TENANT_B_ID, profileBId, 'ZZ 007 Project B'],
  ] as const) {
    const { error } = await db
      .from('projects')
      .upsert({ id, tenant_id: tenantId, created_by: createdBy, name }, { onConflict: 'id' })
    if (error) throw new Error(`ensureTwoTenantFixtures project ${name} failed: ${error.message}`)
  }

  return { authUserAId, authUserBId, profileAId, profileBId }
}

// Tear down the two-tenant fixtures in FK-safe order. The auth_id FK is
// RESTRICT, so public.users rows must go before their auth.users rows; and
// projects.created_by is NO ACTION, so projects must go before their users.
// Call in afterAll.
export async function removeTwoTenantFixtures(): Promise<void> {
  const db = testClient()
  const tenantIds = [TEST_TENANT_A_ID, TEST_TENANT_B_ID]

  const { error: pmErr } = await db.from('project_members').delete().in('tenant_id', tenantIds)
  if (pmErr) throw new Error(`removeTwoTenantFixtures project_members failed: ${pmErr.message}`)

  const { error: projErr } = await db.from('projects').delete().in('tenant_id', tenantIds)
  if (projErr) throw new Error(`removeTwoTenantFixtures projects failed: ${projErr.message}`)

  const { error: userErr } = await db.from('users').delete().in('tenant_id', tenantIds)
  if (userErr) throw new Error(`removeTwoTenantFixtures users failed: ${userErr.message}`)

  for (const email of [TEST_007_USER_A_EMAIL, TEST_007_USER_B_EMAIL]) {
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) throw new Error(`removeTwoTenantFixtures listUsers failed: ${listErr.message}`)
    const u = list.users.find((x) => x.email === email)
    if (u) {
      const { error } = await db.auth.admin.deleteUser(u.id)
      if (error) throw new Error(`removeTwoTenantFixtures deleteUser (${email}) failed: ${error.message}`)
    }
  }

  const { error: tenErr } = await db.from('tenants').delete().in('id', tenantIds)
  if (tenErr) throw new Error(`removeTwoTenantFixtures tenants failed: ${tenErr.message}`)
}
