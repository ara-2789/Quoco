import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  handlePhotoGet,
  DEFAULT_PHOTO_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PHOTO_RATE_LIMIT_WINDOW_MS,
  type PhotoRouteDeps,
} from '@/app/api/photos/[kind]/[photoId]/route'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_USER_B_EMAIL,
  TEST_007_PASSWORD,
} from './helpers/db'
import { getRunId, deriveRunScopedEmail } from './helpers/run-scoped-fixtures'

// Stage 5a (docs/reviews/stage5a-review-package.md, D6, §7; verdict Q1/
// Q2/Q5). Integration tests for app/api/photos/[kind]/[photoId] --
// exercises handlePhotoGet directly with injected clients, the SAME
// function GET calls in production (same shape as test/owner-confirm-
// email.test.ts's own handleConfirmEmailGet/Post pattern) -- no mocks, no
// separate assembly that can drift from what production runs.
//
// EVERY CALL BELOW INJECTS A FRESH rateLimit.store (a new Map() per test,
// per Aravind's build-slice-B1 correction B) so the module-level default
// limiter can never leak state between tests -- same isolation principle
// test/owner-confirm-email.test.ts applies to IPs, applied here to the
// rate limiter's own store instead, since this route's limiter key is
// users.id, not an address. serviceClient is ALWAYS testClient() (the
// test-db service-role client) -- never the production default, which
// would read NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY instead
// of the SUPABASE_TEST_* vars .env.test provides.

const ROUTE_URL = 'https://quoco.test/api/photos'

function buildRequest(): NextRequest {
  return new NextRequest(ROUTE_URL, { method: 'GET' })
}

function anonSignedOutClient(): SupabaseClient {
  return createSupabaseClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function baseDeps(overrides: Partial<PhotoRouteDeps> = {}): PhotoRouteDeps {
  return {
    serviceClient: testClient(),
    rateLimit: { store: new Map() },
    ...overrides,
  }
}

async function headerFingerprint(res: Response): Promise<string> {
  return JSON.stringify(Array.from(res.headers.entries()).sort())
}

describe('app/api/photos/[kind]/[photoId] — route (stage 5a, D6/C5/C6)', () => {
  let pmAId: string
  let pmBId: string
  let qsAId: string
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientQsA: SupabaseClient
  let dailyLogAId: string
  let dlPhotoId: string
  let dlObjectPath: string
  let dlTombstonedPhotoId: string
  const nonexistentPhotoId = randomUUID()
  const qsAEmail = deriveRunScopedEmail(getRunId(), 'PHOTO_ROUTE_QS_A')

  async function ensureAuthUserLocal(db: SupabaseClient, email: string, password: string): Promise<string> {
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) throw new Error(`ensureAuthUserLocal listUsers failed: ${listErr.message}`)
    const existing = list.users.find((u) => u.email === email)
    if (existing) {
      const { error } = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      if (error) throw new Error(`ensureAuthUserLocal updateUserById failed: ${error.message}`)
      return existing.id
    }
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`ensureAuthUserLocal createUser failed: ${error?.message ?? 'no user'}`)
    return data.user.id
  }

  async function claimQsProfile(db: SupabaseClient, authUserId: string): Promise<string> {
    const { data: existing, error: selErr } = await db
      .from('users')
      .select('id')
      .eq('auth_id', authUserId)
      .maybeSingle<{ id: string }>()
    if (selErr) throw new Error(`claimQsProfile select failed: ${selErr.message}`)
    if (existing) {
      const { error } = await db
        .from('users')
        .update({ tenant_id: TEST_TENANT_A_ID, role: 'qs', full_name: 'ZZ Photo Route QS A' })
        .eq('auth_id', authUserId)
      if (error) throw new Error(`claimQsProfile update failed: ${error.message}`)
      return existing.id
    }
    const { data: ins, error } = await db
      .from('users')
      .insert({ auth_id: authUserId, tenant_id: TEST_TENANT_A_ID, role: 'qs', full_name: 'ZZ Photo Route QS A' })
      .select('id')
      .single<{ id: string }>()
    if (error || !ins) throw new Error(`claimQsProfile insert failed: ${error?.message ?? 'no row'}`)
    return ins.id
  }

  beforeAll(async () => {
    const db = testClient()
    const fixtures = await ensureTwoTenantFixtures()
    pmAId = fixtures.profileAId
    pmBId = fixtures.profileBId

    const { error: pmAErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: pmAId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (pmAErr) throw new Error(`seed pmA membership failed: ${pmAErr.message}`)

    const { error: pmBErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_B_ID, project_id: TEST_PROJECT_B_ID, user_id: pmBId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (pmBErr) throw new Error(`seed pmB membership failed: ${pmBErr.message}`)

    const qsAuthId = await ensureAuthUserLocal(db, qsAEmail, TEST_007_PASSWORD)
    qsAId = await claimQsProfile(db, qsAuthId)
    const { error: qsMemberErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: qsAId, role: 'qs' },
      { onConflict: 'project_id,user_id' },
    )
    if (qsMemberErr) throw new Error(`seed qsA membership failed: ${qsMemberErr.message}`)

    const { data: log, error: logErr } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: pmAId,
        log_date: '2026-09-17',
      })
      .select('id')
      .single<{ id: string }>()
    if (logErr || !log) throw new Error(`seed daily_log failed: ${logErr?.message ?? 'no row'}`)
    dailyLogAId = log.id

    dlObjectPath = `${TEST_TENANT_A_ID}/${dailyLogAId}/${randomUUID()}.jpg`
    const { error: uploadErr } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(dlObjectPath, Buffer.from('test'), { contentType: 'image/jpeg', upsert: true })
    if (uploadErr) throw new Error(`seed object upload failed: ${uploadErr.message}`)

    const { data: photo, error: photoErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: dlObjectPath,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (photoErr || !photo) throw new Error(`seed daily_log_photos row failed: ${photoErr?.message ?? 'no row'}`)
    dlPhotoId = photo.id

    const { data: tombstoned, error: tombstonedErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: null,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (tombstonedErr || !tombstoned) throw new Error(`seed tombstoned row failed: ${tombstonedErr?.message ?? 'no row'}`)
    dlTombstonedPhotoId = tombstoned.id

    clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)
    clientQsA = await jwtClient(qsAEmail, TEST_007_PASSWORD)
  })

  afterAll(async () => {
    const db = testClient()
    await clientA?.auth.signOut()
    await clientB?.auth.signOut()
    await clientQsA?.auth.signOut()
    if (dlPhotoId) await db.from('daily_log_photos').delete().eq('id', dlPhotoId)
    if (dlTombstonedPhotoId) await db.from('daily_log_photos').delete().eq('id', dlTombstonedPhotoId)
    if (dlObjectPath) await db.storage.from(PHOTO_BUCKET).remove([dlObjectPath])
    if (dailyLogAId) await db.from('daily_logs').delete().eq('id', dailyLogAId)
    if (qsAId) {
      await db.from('project_members').delete().eq('user_id', qsAId)
      await db.from('users').delete().eq('id', qsAId)
    }
    await db.from('project_members').delete().in('project_id', [TEST_PROJECT_A_ID, TEST_PROJECT_B_ID])
    await removeTwoTenantFixtures()
  })

  it('a PM on the owning project gets a 302 redirect to a signed URL, with Cache-Control: no-store', async () => {
    const res = await handlePhotoGet(
      buildRequest(),
      { kind: 'daily_log', photoId: dlPhotoId },
      baseDeps({ supabaseClient: clientA }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBeTruthy()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('every refusal case returns the identical status, body, and headers', async () => {
    const cases: { name: string; kind: string; photoId: string; client: SupabaseClient }[] = [
      { name: 'cross-tenant PM', kind: 'daily_log', photoId: dlPhotoId, client: clientB },
      { name: 'same-tenant non-PM', kind: 'daily_log', photoId: dlPhotoId, client: clientQsA },
      { name: 'logged-out', kind: 'daily_log', photoId: dlPhotoId, client: anonSignedOutClient() },
      { name: 'nonexistent photo id', kind: 'daily_log', photoId: nonexistentPhotoId, client: clientA },
      { name: 'wrong kind for a real id', kind: 'hindrance', photoId: dlPhotoId, client: clientA },
      { name: 'tombstoned row', kind: 'daily_log', photoId: dlTombstonedPhotoId, client: clientA },
      { name: 'malformed photo id (not a UUID)', kind: 'daily_log', photoId: 'not-a-real-id', client: clientA },
      { name: 'bad kind segment', kind: 'invoice', photoId: dlPhotoId, client: clientA },
    ]

    const responses = await Promise.all(
      cases.map((c) =>
        handlePhotoGet(buildRequest(), { kind: c.kind, photoId: c.photoId }, baseDeps({ supabaseClient: c.client })),
      ),
    )

    for (const [i, res] of responses.entries()) {
      expect(res.status, `status for case "${cases[i].name}"`).toBe(404)
      expect(await res.text(), `body for case "${cases[i].name}"`).toBe('')
      expect(res.headers.get('cache-control'), `cache-control for case "${cases[i].name}"`).toBe('no-store')
    }

    const fingerprints = await Promise.all(responses.map((r) => headerFingerprint(r)))
    for (const [i, fp] of fingerprints.entries()) {
      expect(fp, `headers for case "${cases[i].name}" vs. case "${cases[0].name}"`).toBe(fingerprints[0])
    }
  })

  it('exported rate-limit defaults are 120 requests per 60_000 ms', () => {
    expect(DEFAULT_PHOTO_RATE_LIMIT_MAX_REQUESTS).toBe(120)
    expect(DEFAULT_PHOTO_RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it('rate limit: with max=3 and a fresh store, the first 3 requests succeed and the 4th gets the identical refusal', async () => {
    const store = new Map()
    const deps = baseDeps({ supabaseClient: clientA, rateLimit: { maxRequests: 3, windowMs: 60_000, store } })

    const first = await handlePhotoGet(buildRequest(), { kind: 'daily_log', photoId: dlPhotoId }, deps)
    const second = await handlePhotoGet(buildRequest(), { kind: 'daily_log', photoId: dlPhotoId }, deps)
    const third = await handlePhotoGet(buildRequest(), { kind: 'daily_log', photoId: dlPhotoId }, deps)
    const fourth = await handlePhotoGet(buildRequest(), { kind: 'daily_log', photoId: dlPhotoId }, deps)

    expect(first.status).toBe(302)
    expect(second.status).toBe(302)
    expect(third.status).toBe(302)
    expect(fourth.status).toBe(404)
    expect(await fourth.text()).toBe('')
    expect(fourth.headers.get('cache-control')).toBe('no-store')
  })
})
