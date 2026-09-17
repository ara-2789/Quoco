import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthorizedPhotoPath, PHOTO_BUCKET, type PhotoKind } from '@/lib/storage/photo-access'
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
// (docs/reviews/043-review-package.md §9's own reviewer checklist item 4),
// EXTENDED for stage 5a (docs/reviews/stage5a-review-package.md, C2;
// verdict Q4's closing paragraph -- "the 044 deferral comes due").
//
// The authorization decision for a photo exists TWICE, independently --
//   (A) the daily_log_photos_select / hindrance_photos_select RLS POLICY
//       (SQL, 043/044), the boundary a row must clear to be SELECTed at all;
//   (B) getAuthorizedPhotoPath() (TypeScript, lib/storage/photo-access.ts),
//       the boundary that gates minting a signed URL to the actual bytes,
//       running as service_role -- RLS bypassed entirely.
// These agree TODAY only by parallel construction. This file is the
// failsafe: one SHARED fixture matrix, each case run through BOTH
// boundaries, for BOTH daily_log_photos and hindrance_photos, so a future
// edit to either encoding alone shows up as a same-file test failure.
//
// RE-TARGETED (stage 5a, verdict Q4): the retired getSignedPhotoUrl took
// (objectPath, callerUserId); this file's TS side now calls
// getAuthorizedPhotoPath(kind, photoId, caller) instead -- the route's own
// authorization function, since D6 re-implements the RLS join shapes in
// TS under service_role, which is a NEW copy, proven only by this matrix,
// never by citing the RLS policy text (verdict Q4).
//
// CORRECTED 2026-09-17 (Aravind, build slice B1 corrections): an earlier
// draft of this plan claimed RLS ALLOWS a photo row whose own tenant_id
// disagrees with the caller's, or a NULL-tenant caller. Both are wrong --
// both RLS policies open with `tenant_id = get_user_tenant_id()`
// (043:259-271, 044:292-304), and get_user_tenant_id() is `SELECT
// tenant_id FROM users WHERE auth_id = auth.uid()` (007_auth_surgery.sql:
// 134-142) -- a NULL caller tenant_id makes `tenant_id = NULL` evaluate to
// unknown/false in the RLS USING clause, and a genuinely mismatched photo
// tenant_id makes the equality false directly. RLS refuses BOTH cases,
// same as the TS function -- so both live in this shared matrix
// (expectVisible: false on both boundaries), not as function-only cases.

describe('photo boundary agreement — RLS policy and getAuthorizedPhotoPath() (stage 5a, C2)', () => {
  let pmAId: string
  let pmBId: string
  let qsAId: string
  let nullTenantUserId: string
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientQsA: SupabaseClient
  let clientNullTenant: SupabaseClient
  let dailyLogAId: string
  let hindranceAId: string
  let dlPhotoId: string
  let dlObjectPath: string
  let dlMismatchPhotoId: string
  let hPhotoId: string
  let hObjectPath: string
  let hMismatchPhotoId: string
  const nonexistentPhotoId = randomUUID()
  const qsAEmail = deriveRunScopedEmail(getRunId(), 'PHOTO_BOUNDARY_QS_A')
  const nullTenantEmail = deriveRunScopedEmail(getRunId(), 'PHOTO_BOUNDARY_NULL_TENANT')

  // Mirrors test/helpers/db.ts's own private ensureAuthUser (not exported).
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

    // Same-tenant, non-PM member of project A -- real auth-backed 'qs'
    // user, can carry a real JWT for the RLS half.
    const qsAuthId = await ensureAuthUserLocal(db, qsAEmail, TEST_007_PASSWORD)
    qsAId = await claimQsProfile(db, qsAuthId)
    const { error: qsMemberErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: qsAId, role: 'qs' },
      { onConflict: 'project_id,user_id' },
    )
    if (qsMemberErr) throw new Error(`seed qsA membership failed: ${qsMemberErr.message}`)

    // A caller whose own users.tenant_id is NULL -- the +smoke020 prod
    // shape (docs/build-status.md:253-255). Deliberately NOT claimed via
    // claimProfile: handle_new_user() (007_auth_surgery.sql:152-159)
    // inserts ONLY (id, auth_id) on trigger, so an auth user with no
    // profile claim is left with tenant_id NULL (users.tenant_id has been
    // nullable since 005_auth_trigger.sql:20) and role NULL by default --
    // exactly the shape this case needs, with no synthetic row required.
    const nullTenantAuthId = await ensureAuthUserLocal(db, nullTenantEmail, TEST_007_PASSWORD)
    const { data: nullTenantStub, error: nullTenantErr } = await db
      .from('users')
      .select('id, tenant_id')
      .eq('auth_id', nullTenantAuthId)
      .maybeSingle<{ id: string; tenant_id: string | null }>()
    if (nullTenantErr || !nullTenantStub) {
      throw new Error(
        `null-tenant fixture: expected handle_new_user() to have created a public.users stub for ` +
          `auth_id ${nullTenantAuthId}, found none (${nullTenantErr?.message ?? 'no row'})`,
      )
    }
    if (nullTenantStub.tenant_id !== null) {
      throw new Error(
        `null-tenant fixture: expected the trigger-created stub's tenant_id to be NULL, got ` +
          `${nullTenantStub.tenant_id} -- handle_new_user()'s own insert shape may have changed; ` +
          `this fixture can no longer represent the +smoke020 prod shape as constructed`,
      )
    }
    nullTenantUserId = nullTenantStub.id

    // One real daily_logs row and one real hindrances row, both on project A.
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

    const { data: hindrance, error: hindranceErr } = await db
      .from('hindrances')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        reported_by: pmAId,
        description: 'ZZ boundary-agreement test hindrance',
        timing: 'active',
        submitted_via: 'whatsapp_adhoc',
      })
      .select('id')
      .single<{ id: string }>()
    if (hindranceErr || !hindrance) throw new Error(`seed hindrance failed: ${hindranceErr?.message ?? 'no row'}`)
    hindranceAId = hindrance.id

    // Normal daily_log_photos row (tenant A, correct pairing) + a genuine
    // Storage object, so the positive case exercises a real Storage read.
    dlObjectPath = `${TEST_TENANT_A_ID}/${dailyLogAId}/${randomUUID()}.jpg`
    const { error: dlUploadErr } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(dlObjectPath, Buffer.from('test'), { contentType: 'image/jpeg', upsert: true })
    if (dlUploadErr) throw new Error(`seed daily_log object upload failed: ${dlUploadErr.message}`)
    const { data: dlPhoto, error: dlPhotoErr } = await db
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
    if (dlPhotoErr || !dlPhoto) throw new Error(`seed daily_log_photos row failed: ${dlPhotoErr?.message ?? 'no row'}`)
    dlPhotoId = dlPhoto.id

    // D5 isolation fixture: a SECOND daily_log_photos row pointing at the
    // SAME dailyLogAId (project A), but with tenant_id deliberately set to
    // TEST_TENANT_B_ID -- a shape the real application "cannot produce"
    // (043_daily_log_photos.sql:234-248's own words: this pairing is
    // argued, not FK-enforced) but a test fixture constructs directly.
    // Proves D5 is the deciding factor: pmAId genuinely IS
    // project_members.role='pm' on the project this row's daily_log_id
    // actually belongs to -- if the tenant check were removed, resolution
    // would otherwise succeed.
    const { data: dlMismatch, error: dlMismatchErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_B_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: `${TEST_TENANT_B_ID}/${dailyLogAId}/${randomUUID()}.jpg`,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (dlMismatchErr || !dlMismatch) {
      throw new Error(`seed daily_log_photos tenant-mismatch row failed: ${dlMismatchErr?.message ?? 'no row'}`)
    }
    dlMismatchPhotoId = dlMismatch.id

    // Normal hindrance_photos row (tenant A, correct pairing).
    hObjectPath = `${TEST_TENANT_A_ID}/hindrance/${hindranceAId}/${randomUUID()}.jpg`
    const { data: hPhoto, error: hPhotoErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        hindrance_id: hindranceAId,
        photo_url: hObjectPath,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (hPhotoErr || !hPhoto) throw new Error(`seed hindrance_photos row failed: ${hPhotoErr?.message ?? 'no row'}`)
    hPhotoId = hPhoto.id

    // D5 isolation fixture, hindrance side -- same construction as the
    // daily_log one above.
    const { data: hMismatch, error: hMismatchErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_B_ID,
        hindrance_id: hindranceAId,
        photo_url: `${TEST_TENANT_B_ID}/hindrance/${hindranceAId}/${randomUUID()}.jpg`,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (hMismatchErr || !hMismatch) {
      throw new Error(`seed hindrance_photos tenant-mismatch row failed: ${hMismatchErr?.message ?? 'no row'}`)
    }
    hMismatchPhotoId = hMismatch.id

    clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)
    clientQsA = await jwtClient(qsAEmail, TEST_007_PASSWORD)
    clientNullTenant = await jwtClient(nullTenantEmail, TEST_007_PASSWORD)
  })

  afterAll(async () => {
    const db = testClient()
    await clientA?.auth.signOut()
    await clientB?.auth.signOut()
    await clientQsA?.auth.signOut()
    await clientNullTenant?.auth.signOut()
    if (dlPhotoId) await db.from('daily_log_photos').delete().eq('id', dlPhotoId)
    if (dlMismatchPhotoId) await db.from('daily_log_photos').delete().eq('id', dlMismatchPhotoId)
    if (dlObjectPath) await db.storage.from(PHOTO_BUCKET).remove([dlObjectPath])
    if (hPhotoId) await db.from('hindrance_photos').delete().eq('id', hPhotoId)
    if (hMismatchPhotoId) await db.from('hindrance_photos').delete().eq('id', hMismatchPhotoId)
    if (hindranceAId) await db.from('hindrances').delete().eq('id', hindranceAId)
    if (dailyLogAId) await db.from('daily_logs').delete().eq('id', dailyLogAId)
    if (qsAId) {
      await db.from('project_members').delete().eq('user_id', qsAId)
      await db.from('users').delete().eq('id', qsAId)
    }
    if (nullTenantUserId) {
      await db.from('users').delete().eq('id', nullTenantUserId)
    }
    await db.from('project_members').delete().in('project_id', [TEST_PROJECT_A_ID, TEST_PROJECT_B_ID])
    await removeTwoTenantFixtures()
  })

  async function rlsVisibleCount(client: SupabaseClient, kind: PhotoKind, photoId: string): Promise<number> {
    const table = kind === 'daily_log' ? 'daily_log_photos' : 'hindrance_photos'
    const { data, error } = await client.from(table).select('id').eq('id', photoId)
    if (error) throw new Error(`RLS-enforced select failed (${table}): ${error.message}`)
    return (data ?? []).length
  }

  // THE SHARED FIXTURE MATRIX -- every case run through BOTH boundaries,
  // for BOTH kinds, so a future edit to either the RLS policy or
  // getAuthorizedPhotoPath that changes one boundary's verdict without the
  // other's shows up here as one case's two assertions disagreeing.
  interface MatrixCase {
    name: string
    kind: PhotoKind
    photoId: () => string
    callerId: () => string
    callerTenantId: () => string | null
    client: () => SupabaseClient
    expectVisible: boolean
  }

  const cases: MatrixCase[] = [
    {
      name: 'real-PM shape (admin-shaped users.role, project_members.role=pm) on the owning project — daily_log',
      kind: 'daily_log',
      photoId: () => dlPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: true,
    },
    {
      name: 'real-PM shape (admin-shaped users.role, project_members.role=pm) on the owning project — hindrance',
      kind: 'hindrance',
      photoId: () => hPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: true,
    },
    {
      name: "cross-tenant: PM on a different tenant's project — daily_log",
      kind: 'daily_log',
      photoId: () => dlPhotoId,
      callerId: () => pmBId,
      callerTenantId: () => TEST_TENANT_B_ID,
      client: () => clientB,
      expectVisible: false,
    },
    {
      name: "cross-tenant: PM on a different tenant's project — hindrance",
      kind: 'hindrance',
      photoId: () => hPhotoId,
      callerId: () => pmBId,
      callerTenantId: () => TEST_TENANT_B_ID,
      client: () => clientB,
      expectVisible: false,
    },
    {
      name: 'same-tenant non-PM (qs), real member of the same project — daily_log',
      kind: 'daily_log',
      photoId: () => dlPhotoId,
      callerId: () => qsAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientQsA,
      expectVisible: false,
    },
    {
      name: 'same-tenant non-PM (qs), real member of the same project — hindrance',
      kind: 'hindrance',
      photoId: () => hPhotoId,
      callerId: () => qsAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientQsA,
      expectVisible: false,
    },
    {
      name: 'nonexistent photo id — daily_log',
      kind: 'daily_log',
      photoId: () => nonexistentPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: false,
    },
    {
      name: 'nonexistent photo id — hindrance',
      kind: 'hindrance',
      photoId: () => nonexistentPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: false,
    },
    {
      name: "D5 isolation: photo row's own tenant_id disagrees with the caller's, though the caller genuinely IS PM on the project the row's daily_log belongs to — daily_log",
      kind: 'daily_log',
      photoId: () => dlMismatchPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: false,
    },
    {
      name: "D5 isolation: photo row's own tenant_id disagrees with the caller's, though the caller genuinely IS PM on the project the row's hindrance belongs to — hindrance",
      kind: 'hindrance',
      photoId: () => hMismatchPhotoId,
      callerId: () => pmAId,
      callerTenantId: () => TEST_TENANT_A_ID,
      client: () => clientA,
      expectVisible: false,
    },
    {
      name: 'NULL-tenant caller (the +smoke020 prod shape) — daily_log',
      kind: 'daily_log',
      photoId: () => dlPhotoId,
      callerId: () => nullTenantUserId,
      callerTenantId: () => null,
      client: () => clientNullTenant,
      expectVisible: false,
    },
    {
      name: 'NULL-tenant caller (the +smoke020 prod shape) — hindrance',
      kind: 'hindrance',
      photoId: () => hPhotoId,
      callerId: () => nullTenantUserId,
      callerTenantId: () => null,
      client: () => clientNullTenant,
      expectVisible: false,
    },
  ]

  describe.each(cases)('$name', (c) => {
    it('getAuthorizedPhotoPath() and the RLS-enforced SELECT agree', async () => {
      const path = await getAuthorizedPhotoPath(
        c.kind,
        c.photoId(),
        { id: c.callerId(), tenant_id: c.callerTenantId() },
        testClient(),
      )
      const visibleCount = await rlsVisibleCount(c.client(), c.kind, c.photoId())

      if (c.expectVisible) {
        expect(path).not.toBeNull()
        expect(typeof path).toBe('string')
        expect(visibleCount).toBe(1)
      } else {
        expect(path).toBeNull()
        expect(visibleCount).toBe(0)
      }
    })
  })
})
