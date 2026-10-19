// Fixture kit for the PR-B (migration 050) capture-flow suites. NOT YET RUN: 050 is not applied to test-db.
//
// CONVENTIONS (same as the rest of the suite):
//  * every identifier a test asserts on carries ZZTestCapture-${RUN_TAG}-<scenario>; RUN_TAG = crypto.randomUUID()
//    per kit (v3 section 9);
//  * tenants are created with slug zz-test-capture-<label>-<runId> so the quoco_test_capture_* helpers' ONE guard
//    (tenants.slug LIKE 'zz-test-capture-%') accepts them and nothing else (scripts/test-db-only-capture-helpers.sql);
//  * ids, e-mails and phones are run-scoped (test/helpers/run-scoped-fixtures.ts);
//  * the suites NEVER call an unscoped claimJobs / runJobsTick; the only jobs they touch are read by payload.tenant_id
//    and deleted by it at teardown.
//
// Clients are UNTYPED (D-24): types/database.ts does not contain the 049 tables or the 050 functions until the
// regeneration after the prod apply. URL and keys come from the SUPABASE_TEST_* vars that test/setup/guard.ts has
// already proven point at test-db.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { deriveRunScopedEmail, deriveRunScopedPhone, deriveRunScopedUuid, getRunId } from './run-scoped-fixtures'

const CLIENT_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const

// Branch-only throwaway password for the minted auth users (same reasoning as TEST_007_PASSWORD in db.ts).
export const CAPTURE_TEST_PASSWORD = 'zz-capture-Rehearsal-Pw-2c91'

export function captureService(): SupabaseClient {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, CLIENT_OPTS)
}

export function captureAnon(): SupabaseClient {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, CLIENT_OPTS)
}

/** An ANON-key client carrying the given user's session JWT, so RLS and the authenticated grants really apply. */
export async function captureJwtClient(email: string): Promise<SupabaseClient> {
  const client = captureAnon()
  const { error } = await client.auth.signInWithPassword({ email, password: CAPTURE_TEST_PASSWORD })
  if (error) throw new Error(`captureJwtClient signIn (${email}) failed: ${error.message}`)
  return client
}

export type CaptureUserLabel =
  | 'eng' //       engineer, active, member of P1 (no web login)
  | 'engP2' //     engineer, active, member of P2 (same tenant as eng; for the "other project" fixtures, S-1)
  | 'engB' //      engineer in tenant B, member of P3
  | 'pm1' //       PM, active, pm member of P1
  | 'pm2' //       PM, active, pm member of P2 (same tenant, other project)
  | 'pmB' //       PM, active, pm member of P3 (other tenant)
  | 'qs' //        qs, active, member of P1
  | 'deact' //     pm, status deactivated, pm member of P1
  | 'pend' //      pm, status pending, pm member of P1
  | 'admNon' //    admin, active, NO membership
  | 'admMem' //    admin, active, pm member of P1

interface UserSpec {
  role: string
  status: string
  tenant: 'A' | 'B'
  login: boolean
  member?: { project: 'P1' | 'P2' | 'P3'; role: string }
}

const USER_SPECS: Record<CaptureUserLabel, UserSpec> = {
  eng: { role: 'engineer', status: 'active', tenant: 'A', login: false, member: { project: 'P1', role: 'engineer' } },
  engP2: { role: 'engineer', status: 'active', tenant: 'A', login: false, member: { project: 'P2', role: 'engineer' } },
  engB: { role: 'engineer', status: 'active', tenant: 'B', login: false, member: { project: 'P3', role: 'engineer' } },
  pm1: { role: 'pm', status: 'active', tenant: 'A', login: true, member: { project: 'P1', role: 'pm' } },
  pm2: { role: 'pm', status: 'active', tenant: 'A', login: true, member: { project: 'P2', role: 'pm' } },
  pmB: { role: 'pm', status: 'active', tenant: 'B', login: true, member: { project: 'P3', role: 'pm' } },
  qs: { role: 'qs', status: 'active', tenant: 'A', login: true, member: { project: 'P1', role: 'qs' } },
  deact: { role: 'pm', status: 'deactivated', tenant: 'A', login: true, member: { project: 'P1', role: 'pm' } },
  pend: { role: 'pm', status: 'pending', tenant: 'A', login: true, member: { project: 'P1', role: 'pm' } },
  admNon: { role: 'admin', status: 'active', tenant: 'A', login: true },
  admMem: { role: 'admin', status: 'active', tenant: 'A', login: true, member: { project: 'P1', role: 'pm' } },
}

export interface CaptureKitUser {
  id: string
  email: string | null
  authId: string | null
}

export interface CaptureKit {
  svc: SupabaseClient
  /** per-kit random tag; goes into every asserted identifier */
  runTag: string
  tenantA: string
  tenantB: string
  p1: string
  p2: string
  p3: string
  users: Partial<Record<CaptureUserLabel, CaptureKitUser>>
  phones: string[]
  /** ZZTestCapture-${runTag}-<scenario> */
  sid: (scenario: string) => string
  /** a run-scoped fake phone for a scenario; remembered for teardown */
  phone: (scenario: string) => string
  /** the id of a minted user (throws if the kit was built without it) */
  uid: (label: CaptureUserLabel) => string
  jwt: (label: CaptureUserLabel) => Promise<SupabaseClient>
}

async function mintAuthUser(svc: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({ email, password: CAPTURE_TEST_PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`mintAuthUser (${email}) failed: ${error?.message ?? 'no user'}`)
  return data.user.id
}

// Post-007 the on_auth_user_created trigger inserts a public.users stub (auth_id = the new auth id): claim it.
async function claimProfile(
  svc: SupabaseClient,
  authId: string,
  tenantId: string,
  spec: UserSpec,
  fullName: string,
): Promise<string> {
  const { data: existing, error: selErr } = await svc.from('users').select('id').eq('auth_id', authId).maybeSingle<{ id: string }>()
  if (selErr) throw new Error(`claimProfile select failed: ${selErr.message}`)
  const patch = { tenant_id: tenantId, role: spec.role, status: spec.status, full_name: fullName }
  if (existing) {
    const { error } = await svc.from('users').update(patch).eq('auth_id', authId)
    if (error) throw new Error(`claimProfile update failed: ${error.message}`)
    return existing.id
  }
  const { data: ins, error } = await svc.from('users').insert({ auth_id: authId, ...patch }).select('id').single<{ id: string }>()
  if (error || !ins) throw new Error(`claimProfile insert failed: ${error?.message ?? 'no row'}`)
  return ins.id
}

/**
 * Build tenants A and B, projects P1 and P2 (A) and P3 (B), and the requested users with their memberships.
 * `fileTag` makes every derived id distinct per test file. Call in beforeAll; pair with teardownCaptureKit in afterAll.
 */
export async function buildCaptureKit(fileTag: string, labels: readonly CaptureUserLabel[]): Promise<CaptureKit> {
  const svc = captureService()
  const runId = getRunId()
  const runTag = randomUUID()
  const key = (l: string) => `capture:${fileTag}:${l}`
  const tenantA = deriveRunScopedUuid(runId, key('tenantA'))
  const tenantB = deriveRunScopedUuid(runId, key('tenantB'))
  const p1 = deriveRunScopedUuid(runId, key('P1'))
  const p2 = deriveRunScopedUuid(runId, key('P2'))
  const p3 = deriveRunScopedUuid(runId, key('P3'))

  for (const [id, slug, name] of [
    [tenantA, `zz-test-capture-${fileTag}-a-${runId}`, `ZZTestCapture-${runTag}-tenant-a`],
    [tenantB, `zz-test-capture-${fileTag}-b-${runId}`, `ZZTestCapture-${runTag}-tenant-b`],
  ] as const) {
    const { error } = await svc.from('tenants').upsert({ id, slug, name }, { onConflict: 'id' })
    if (error) throw new Error(`buildCaptureKit tenant ${slug} failed: ${error.message}`)
  }

  const users: Partial<Record<CaptureUserLabel, CaptureKitUser>> = {}
  for (const label of labels) {
    const spec = USER_SPECS[label]
    const tenantId = spec.tenant === 'A' ? tenantA : tenantB
    const fullName = `ZZTestCapture-${runTag}-${label}`
    if (spec.login) {
      const email = deriveRunScopedEmail(runId, key(label))
      const authId = await mintAuthUser(svc, email)
      users[label] = { id: await claimProfile(svc, authId, tenantId, spec, fullName), email, authId }
    } else {
      const { data, error } = await svc
        .from('users')
        .insert({ tenant_id: tenantId, role: spec.role, status: spec.status, full_name: fullName })
        .select('id')
        .single<{ id: string }>()
      if (error || !data) throw new Error(`buildCaptureKit engineer ${label} failed: ${error?.message ?? 'no row'}`)
      users[label] = { id: data.id, email: null, authId: null }
    }
  }

  const creator = users.pm1?.id ?? users.eng?.id ?? users.admNon?.id ?? null
  for (const [id, tenantId, name] of [
    [p1, tenantA, `ZZTestCapture-${runTag}-P1`],
    [p2, tenantA, `ZZTestCapture-${runTag}-P2`],
    [p3, tenantB, `ZZTestCapture-${runTag}-P3`],
  ] as const) {
    const { error } = await svc.from('projects').upsert({ id, tenant_id: tenantId, name, created_by: creator }, { onConflict: 'id' })
    if (error) throw new Error(`buildCaptureKit project ${name} failed: ${error.message}`)
  }

  const projectId = { P1: p1, P2: p2, P3: p3 } as const
  for (const label of labels) {
    const spec = USER_SPECS[label]
    const u = users[label]
    if (!spec.member || !u) continue
    const { error } = await svc.from('project_members').insert({
      tenant_id: spec.tenant === 'A' ? tenantA : tenantB,
      project_id: projectId[spec.member.project],
      user_id: u.id,
      role: spec.member.role,
    })
    if (error) throw new Error(`buildCaptureKit membership ${label} failed: ${error.message}`)
  }

  const phones: string[] = []
  const kit: CaptureKit = {
    svc,
    runTag,
    tenantA,
    tenantB,
    p1,
    p2,
    p3,
    users,
    phones,
    sid: (scenario) => `ZZTestCapture-${runTag}-${scenario}`,
    phone: (scenario) => {
      const p = deriveRunScopedPhone(runId, key(`phone:${scenario}`))
      if (!phones.includes(p)) phones.push(p)
      return p
    },
    uid: (label) => {
      const u = users[label]
      if (!u) throw new Error(`capture kit was built without user ${label}`)
      return u.id
    },
    jwt: async (label) => {
      const u = users[label]
      if (!u?.email) throw new Error(`capture kit user ${label} has no login`)
      return captureJwtClient(u.email)
    },
  }
  return kit
}

/** FK-safe teardown. The 049 rows go first, through the fixture-tenant-guarded helper (service_role has no DELETE). */
export async function teardownCaptureKit(kit: CaptureKit): Promise<void> {
  const svc = kit.svc
  for (const tenantId of [kit.tenantA, kit.tenantB]) {
    const { error } = await svc.rpc('quoco_test_capture_cleanup', { p_tenant_id: tenantId })
    if (error) throw new Error(`teardown quoco_test_capture_cleanup failed: ${error.message}`)
    // jobs created by apply_material_inward_turn carry the tenant in the payload
    const { error: jobErr } = await svc.from('jobs').delete().eq('type', 'capture_ingest').contains('payload', { tenant_id: tenantId })
    if (jobErr) throw new Error(`teardown jobs failed: ${jobErr.message}`)
    const { error: logErr } = await svc.from('daily_logs').delete().eq('tenant_id', tenantId)
    if (logErr) throw new Error(`teardown daily_logs failed: ${logErr.message}`)
  }
  const { error: pmErr } = await svc.from('processed_messages').delete().like('message_sid', `ZZTestCapture-${kit.runTag}-%`)
  if (pmErr) throw new Error(`teardown processed_messages failed: ${pmErr.message}`)
  if (kit.phones.length > 0) {
    const { error } = await svc.from('whatsapp_sessions').delete().in('phone_number', kit.phones)
    if (error) throw new Error(`teardown whatsapp_sessions failed: ${error.message}`)
  }
  const tenantIds = [kit.tenantA, kit.tenantB]
  const { error: memErr } = await svc.from('project_members').delete().in('tenant_id', tenantIds)
  if (memErr) throw new Error(`teardown project_members failed: ${memErr.message}`)
  const { error: projErr } = await svc.from('projects').delete().in('tenant_id', tenantIds)
  if (projErr) throw new Error(`teardown projects failed: ${projErr.message}`)
  const { error: userErr } = await svc.from('users').delete().in('tenant_id', tenantIds)
  if (userErr) throw new Error(`teardown users failed: ${userErr.message}`)
  for (const u of Object.values(kit.users)) {
    if (u?.authId) {
      const { error } = await svc.auth.admin.deleteUser(u.authId)
      if (error) throw new Error(`teardown deleteUser failed: ${error.message}`)
    }
  }
  const { error: tenErr } = await svc.from('tenants').delete().in('id', tenantIds)
  if (tenErr) throw new Error(`teardown tenants failed: ${tenErr.message}`)
}

// ---------------------------------------------------------------------------
// Engineer-side calls (service_role, through PostgREST: the real grant path)
// ---------------------------------------------------------------------------

export interface MiTurn {
  outcome: string
  current_flow: string | null
  current_step: number
  document_id?: string | null
  delivery_id?: string | null
}

export function jpegMedia(n: number): Array<{ index: number; content_type: string; url: string }> {
  return Array.from({ length: n }, (_, index) => ({ index, content_type: 'image/jpeg', url: `https://example.invalid/m/${index}` }))
}

/** The instant of 12:00 IST today, as ISO. Time-travel base for p_now so +31 min never crosses an IST midnight. */
export function noonIst(): Date {
  const now = new Date()
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000)
  const noonUtcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 12, 0, 0) - 5.5 * 3600 * 1000
  return new Date(noonUtcMs)
}

export interface TurnOpts {
  media?: ReturnType<typeof jpegMedia>
  start?: boolean
  now?: Date
  /** do NOT insert the processed_messages row first (to test the Q2-6 refusal) */
  skipProcessed?: boolean
  tenantId?: string
  projectId?: string
  userId?: string
}

export async function miTurnRaw(kit: CaptureKit, phone: string, message: string | null, sid: string, o: TurnOpts = {}) {
  if (!o.skipProcessed) {
    const { error: pErr } = await kit.svc.from('processed_messages').insert({ message_sid: sid })
    if (pErr && pErr.code !== '23505') throw new Error(`processed_messages insert failed: ${pErr.message}`)
  }
  return kit.svc.rpc('apply_material_inward_turn', {
    p_phone_number: phone,
    p_tenant_id: o.tenantId ?? kit.tenantA,
    p_user_id: o.userId ?? kit.uid('eng'),
    p_project_id: o.projectId ?? kit.p1,
    p_message: message,
    p_message_sid: sid,
    p_media: o.media ?? null,
    p_start_flow: o.start ?? false,
    ...(o.now ? { p_now: o.now.toISOString() } : {}),
  })
}

/** One engineer turn; throws on a PostgREST error, returns the jsonb result. */
export async function miTurn(kit: CaptureKit, phone: string, message: string | null, sid: string, o: TurnOpts = {}): Promise<MiTurn> {
  const { data, error } = await miTurnRaw(kit, phone, message, sid, o)
  if (error) throw new Error(`apply_material_inward_turn failed (${error.code}): ${error.message}`)
  return data as MiTurn
}

export interface MadeDoc {
  phone: string
  docId: string
  deliveryId: string
  fileSid: string
}

/**
 * Drive the REAL engineer function to S3 (document + delivery + files exist; the ack is still pending):
 * start (4) -> kind ('1' = DC, '2' = invoice) -> file. `label` keeps SIDs and the phone unique per scenario.
 */
export async function makeDoc(
  kit: CaptureKit,
  kind: 'dc' | 'invoice',
  label: string,
  o: { now?: Date; tenantId?: string; projectId?: string; userId?: string } = {},
): Promise<MadeDoc> {
  const phone = kit.phone(label)
  const base = { ...(o.now ? { now: o.now } : {}), ...(o.tenantId ? { tenantId: o.tenantId } : {}), ...(o.projectId ? { projectId: o.projectId } : {}), ...(o.userId ? { userId: o.userId } : {}) }
  await miTurn(kit, phone, '4', kit.sid(`${label}-s0`), { ...base, start: true })
  await miTurn(kit, phone, kind === 'dc' ? '1' : '2', kit.sid(`${label}-s1`), base)
  const fileSid = kit.sid(`${label}-s2`)
  const r = await miTurn(kit, phone, null, fileSid, { ...base, media: jpegMedia(1) })
  if (!r.document_id || !r.delivery_id) throw new Error(`makeDoc(${label}): no document_id/delivery_id in ${JSON.stringify(r)}`)
  return { phone, docId: r.document_id, deliveryId: r.delivery_id, fileSid }
}

export async function ack(kit: CaptureKit, d: MadeDoc, reply: string, label: string, now?: Date): Promise<MiTurn> {
  return miTurn(kit, d.phone, reply, kit.sid(`${label}-ack`), now ? { now } : {})
}

// ---------------------------------------------------------------------------
// Row readers (service_role has SELECT on the four tables)
// ---------------------------------------------------------------------------

export interface DeliveryRow {
  id: string
  status: string
  delivery_type: string | null
  dc_document_id: string | null
  created_from_invoice_id: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  received_at: string
  tenant_id: string
  project_id: string
}

export interface DocRow {
  id: string
  kind: string
  engineer_ack: string | null
  engineer_ack_note: string | null
  source_message_sid: string
  caption: string | null
}

export interface LinkRow {
  id: string
  delivery_id: string
  invoice_document_id: string
  link_source: string
  linked_by: string | null
  unlinked_at: string | null
  unlink_reason: string | null
  superseded_from_status: string | null
}

export async function getDelivery(kit: CaptureKit, id: string): Promise<DeliveryRow> {
  const { data, error } = await kit.svc.from('deliveries').select('*').eq('id', id).single<DeliveryRow>()
  if (error || !data) throw new Error(`getDelivery(${id}) failed: ${error?.message ?? 'no row'}`)
  return data
}

export async function getDoc(kit: CaptureKit, id: string): Promise<DocRow> {
  const { data, error } = await kit.svc.from('capture_documents').select('*').eq('id', id).single<DocRow>()
  if (error || !data) throw new Error(`getDoc(${id}) failed: ${error?.message ?? 'no row'}`)
  return data
}

export async function linksOfInvoice(kit: CaptureKit, invoiceId: string): Promise<LinkRow[]> {
  const { data, error } = await kit.svc.from('delivery_invoice_links').select('*').eq('invoice_document_id', invoiceId).order('created_at')
  if (error) throw new Error(`linksOfInvoice failed: ${error.message}`)
  return (data ?? []) as LinkRow[]
}

export async function linksOfDelivery(kit: CaptureKit, deliveryId: string): Promise<LinkRow[]> {
  const { data, error } = await kit.svc.from('delivery_invoice_links').select('*').eq('delivery_id', deliveryId).order('created_at')
  if (error) throw new Error(`linksOfDelivery failed: ${error.message}`)
  return (data ?? []) as LinkRow[]
}

export interface SessionRow {
  current_flow: string | null
  current_step: number
  context: Record<string, unknown>
  expires_at: string
  updated_at: string
}

export async function getSession(kit: CaptureKit, phone: string): Promise<SessionRow | null> {
  const { data, error } = await kit.svc
    .from('whatsapp_sessions')
    .select('current_flow,current_step,context,expires_at,updated_at')
    .eq('phone_number', phone)
    .maybeSingle<SessionRow>()
  if (error) throw new Error(`getSession failed: ${error.message}`)
  return data
}

/** Insert a whatsapp_sessions row directly (service_role has the grant): used to seed morning/evening/stale sessions. */
export async function seedSession(
  kit: CaptureKit,
  phone: string,
  row: { flow: string | null; step: number; context: Record<string, unknown>; updatedAt: Date; expiresAt: Date; tenantId?: string; userId?: string },
): Promise<void> {
  const { error } = await kit.svc.from('whatsapp_sessions').insert({
    phone_number: phone,
    tenant_id: row.tenantId ?? kit.tenantA,
    user_id: row.userId ?? kit.uid('eng'),
    current_flow: row.flow,
    current_step: row.step,
    context: row.context,
    pending_flows: [],
    updated_at: row.updatedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  })
  if (error) throw new Error(`seedSession failed: ${error.message}`)
}

/** Today's IST date as YYYY-MM-DD. */
export function istToday(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000)
  return ist.toISOString().slice(0, 10)
}
