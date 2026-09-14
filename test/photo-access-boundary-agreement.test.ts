import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSignedPhotoUrl, PHOTO_BUCKET } from '@/lib/storage/photo-access'
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

// Stage 1 of the media capability, external review round 1, item 6
// (docs/reviews/043-review-package.md §9's own reviewer checklist item 4,
// promoted to a required fix by the round-1 verdict). The reviewer's
// finding: the authorization decision for a photo exists TWICE,
// independently --
//   (A) the daily_log_photos_select RLS POLICY (SQL, 043_daily_log_
//       photos.sql), the boundary a row must clear to be SELECTed at all;
//   (B) getSignedPhotoUrl() (TypeScript, lib/storage/photo-access.ts), the
//       boundary that gates minting a signed URL to the actual bytes,
//       running as service_role -- RLS bypassed entirely.
// These agree TODAY only by parallel construction -- two people (or one
// person, twice) independently wrote "PM, correct project" in two
// languages. Nothing keeps them in sync if either is edited alone. One
// asymmetry already exists between them, named here rather than hidden:
// the RLS policy carries an explicit `tenant_id = get_user_tenant_id()`
// clause; getSignedPhotoUrl carries no equivalent tenant_id check at all --
// it derives project_id from daily_log_id and checks project_members
// directly, with no tenant column consulted anywhere in its own logic.
// This happens to produce the same cross-tenant denial today (a project
// belongs to exactly one tenant, so "member of this project" already
// implies "correct tenant" transitively) -- but that is a property of the
// CURRENT schema, not something either boundary's own code enforces
// directly. A future edit to either encoding -- adding a role, loosening a
// join, changing project_members' shape -- has nothing here to fail loudly
// against the OTHER boundary if it drifts. This file is that failsafe: one
// SHARED fixture matrix, each case run through BOTH boundaries, so a
// future edit to either one alone shows up as a same-file test failure,
// not a silent divergence discovered later.
//
// Reuses the 007 two-tenant fixture (ensureTwoTenantFixtures) for tenant
// A/B and their PM users, same as test/storage-photo-access.test.ts --
// adds its own project_members rows (the fixture creates none), its own
// third, JWT-capable "qs" user in tenant A (the fixture's own two users
// are both role='admin'; neither is a non-PM project MEMBER of project A,
// which is the shape this suite specifically needs for the "non-PM,
// correct tenant" case), and its own one real daily_log_photos row + a
// genuine Storage object at its path.

describe('daily_log_photos — RLS policy and getSignedPhotoUrl() boundary agreement (external review round 1, item 6)', () => {
  let pmAId: string
  let pmBId: string
  let qsAId: string
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientQsA: SupabaseClient
  let dailyLogAId: string
  let photoId: string
  let objectPathA: string
  const nonexistentDailyLogId = randomUUID()
  const qsAEmail = deriveRunScopedEmail(getRunId(), 'PHOTO_BOUNDARY_QS_A')

  // Mirrors test/helpers/db.ts's own private ensureAuthUser/claimProfile
  // (not exported -- this suite is the only one that needs a THIRD
  // JWT-capable user under the two-tenant fixture, so it builds its own
  // rather than widening a shared helper for a shape only one file uses).
  async function ensureQsAuthUser(db: SupabaseClient, email: string, password: string): Promise<string> {
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) throw new Error(`ensureQsAuthUser listUsers failed: ${listErr.message}`)
    const existing = list.users.find((u) => u.email === email)
    if (existing) {
      const { error } = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      if (error) throw new Error(`ensureQsAuthUser updateUserById failed: ${error.message}`)
      return existing.id
    }
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`ensureQsAuthUser createUser failed: ${error?.message ?? 'no user'}`)
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
        .update({ tenant_id: TEST_TENANT_A_ID, role: 'qs', full_name: 'ZZ Photo Boundary QS A' })
        .eq('auth_id', authUserId)
      if (error) throw new Error(`claimQsProfile update failed: ${error.message}`)
      return existing.id
    }
    const { data: ins, error } = await db
      .from('users')
      .insert({ auth_id: authUserId, tenant_id: TEST_TENANT_A_ID, role: 'qs', full_name: 'ZZ Photo Boundary QS A' })
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

    // project_members: PM A on project A, PM B on project B -- the
    // fixture itself creates neither (same gap storage-photo-access.
    // test.ts already works around).
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

    // The "non-PM, correct tenant" caller for BOTH boundaries: a real
    // auth-backed 'qs' user, tenant A, who IS a member of project A but
    // with project_members.role = 'qs' -- not 'pm'. This exercises the
    // `pm.role = 'pm'` clause specifically (as distinct from "not a member
    // at all"), and, unlike an 'engineer' row (auth_id NULL, per CLAUDE.md
    // §5 -- no web login), can actually sign in and carry a real JWT, which
    // the RLS half of this suite requires.
    const qsAuthId = await ensureQsAuthUser(db, qsAEmail, TEST_007_PASSWORD)
    qsAId = await claimQsProfile(db, qsAuthId)
    const { error: qsMemberErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: qsAId, role: 'qs' },
      { onConflict: 'project_id,user_id' },
    )
    if (qsMemberErr) throw new Error(`seed qsA membership failed: ${qsMemberErr.message}`)

    // One real daily_logs row on project A, and one real daily_log_photos
    // row on it -- the single shared target every matrix case below
    // reasons about (either directly, or by contrast with the nonexistent
    // id case).
    const { data: log, error: logErr } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: pmAId,
        log_date: '2026-09-14',
      })
      .select('id')
      .single<{ id: string }>()
    if (logErr || !log) throw new Error(`seed daily_log failed: ${logErr?.message ?? 'no row'}`)
    dailyLogAId = log.id

    objectPathA = `${TEST_TENANT_A_ID}/${dailyLogAId}/${randomUUID()}.jpg`

    // A real Storage object at that path, so getSignedPhotoUrl's positive
    // case exercises a genuine Storage read, not just the membership-check
    // half of the function (same reasoning as storage-photo-access.
    // test.ts's own seed).
    const { error: uploadErr } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(objectPathA, Buffer.from('test'), { contentType: 'image/jpeg', upsert: true })
    if (uploadErr) throw new Error(`seed object upload failed: ${uploadErr.message}`)

    const { data: photo, error: photoErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: objectPathA,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (photoErr || !photo) throw new Error(`seed daily_log_photos row failed: ${photoErr?.message ?? 'no row'}`)
    photoId = photo.id

    clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)
    clientQsA = await jwtClient(qsAEmail, TEST_007_PASSWORD)
  })

  afterAll(async () => {
    const db = testClient()
    await clientA?.auth.signOut()
    await clientB?.auth.signOut()
    await clientQsA?.auth.signOut()
    if (photoId) await db.from('daily_log_photos').delete().eq('id', photoId)
    if (objectPathA) await db.storage.from(PHOTO_BUCKET).remove([objectPathA])
    if (dailyLogAId) await db.from('daily_logs').delete().eq('id', dailyLogAId)
    if (qsAId) {
      await db.from('project_members').delete().eq('user_id', qsAId)
      await db.from('users').delete().eq('id', qsAId)
    }
    await db.from('project_members').delete().in('project_id', [TEST_PROJECT_A_ID, TEST_PROJECT_B_ID])
    await removeTwoTenantFixtures()
  })

  // The RLS-enforced half of each case: does THIS caller's own JWT client
  // see the row at all, filtered by the same daily_log_id the object
  // path's own tenant/daily_log_id segments encode -- the identical
  // identifying value getSignedPhotoUrl's extractDailyLogId() pulls out of
  // objectPath for the OTHER half of the same case. Returns a count, not a
  // boolean, so a case that unexpectedly returns >1 row fails loudly
  // instead of being coerced into "visible" the same as exactly 1.
  async function rlsVisibleCount(client: SupabaseClient, dailyLogId: string): Promise<number> {
    const { data, error } = await client.from('daily_log_photos').select('id').eq('daily_log_id', dailyLogId)
    if (error) throw new Error(`RLS-enforced select failed: ${error.message}`)
    return (data ?? []).length
  }

  // THE SHARED FIXTURE MATRIX. Every case below is asserted against BOTH
  // boundaries in the same `it` -- that is the point: a future edit to
  // either the RLS policy or getSignedPhotoUrl that changes ONE boundary's
  // verdict without the other's shows up here as one case's two
  // assertions disagreeing, not as two separate, easy-to-miss test files.
  const cases: {
    name: string
    dailyLogId: () => string
    objectPath: () => string
    callerUserId: () => string
    client: () => SupabaseClient
    expectVisible: boolean
  }[] = [
    {
      name: 'PM on the owning project',
      dailyLogId: () => dailyLogAId,
      objectPath: () => objectPathA,
      callerUserId: () => pmAId,
      client: () => clientA,
      expectVisible: true,
    },
    {
      name: "PM on another tenant's project (cross-tenant)",
      dailyLogId: () => dailyLogAId,
      objectPath: () => objectPathA,
      callerUserId: () => pmBId,
      client: () => clientB,
      expectVisible: false,
    },
    {
      name: 'non-PM (qs) in the correct tenant, a real member of the same project',
      dailyLogId: () => dailyLogAId,
      objectPath: () => objectPathA,
      callerUserId: () => qsAId,
      client: () => clientQsA,
      expectVisible: false,
    },
    {
      name: 'a nonexistent daily_log',
      dailyLogId: () => nonexistentDailyLogId,
      objectPath: () => `${TEST_TENANT_A_ID}/${nonexistentDailyLogId}/${randomUUID()}.jpg`,
      callerUserId: () => pmAId,
      client: () => clientA,
      expectVisible: false,
    },
  ]

  describe.each(cases)('$name', (c) => {
    it('getSignedPhotoUrl() and the RLS-enforced SELECT agree', async () => {
      const url = await getSignedPhotoUrl({
        objectPath: c.objectPath(),
        callerUserId: c.callerUserId(),
        supabaseClient: testClient(),
      })
      const visibleCount = await rlsVisibleCount(c.client(), c.dailyLogId())

      if (c.expectVisible) {
        expect(url).not.toBeNull()
        expect(typeof url).toBe('string')
        expect(visibleCount).toBe(1)
      } else {
        expect(url).toBeNull()
        expect(visibleCount).toBe(0)
      }
    })
  })
})
