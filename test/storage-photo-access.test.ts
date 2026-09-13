import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
} from './helpers/db'
import { getSignedPhotoUrl, PHOTO_BUCKET } from '@/lib/storage/photo-access'

// Stage 0 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage0-storage-setup-plan.md). Per Aravind's 2026-09-13
// decision, getSignedPhotoUrl() is the ENTIRE tenant-isolation boundary for
// photo objects -- there is no Storage RLS behind it. This suite is
// therefore not a checkbox confirming a second layer; it is the deliverable
// that verifies tenant isolation exists at all (docs/plans/
// stage0-storage-setup-plan.md §6's own framing, restated here).
//
// Reuses the project's existing two-tenant fixture (test/helpers/db.ts's
// ensureTwoTenantFixtures/removeTwoTenantFixtures), built originally for
// migration 007's own RLS tests -- this suite adds project_members rows
// (the fixture itself creates tenants/projects/profiles but no membership
// rows), one extra non-PM user, and one daily_logs row of its own.
//
// FIRST DRAFT COULD NOT RUN, FIXED SAME DAY (2026-09-13). Written and
// type-checked (npx tsc --noEmit, clean) in an environment with no test-db
// credentials (test/setup/guard.ts hard-aborts the ENTIRE vitest run without
// them) -- every case called getSignedPhotoUrl() with no supabaseClient,
// so the helper fell back to createServiceClient() (lib/supabase/service.ts),
// which reads NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, not the
// SUPABASE_TEST_* vars .env.test provides -- "supabaseUrl is required" on
// every case, the moment a real run was attempted (photo-access.ts itself
// was never at fault; it never even ran). Fixed by threading testClient()
// through the existing supabaseClient parameter on every call, below --
// getSignedPhotoUrl's own logic and lib/supabase/service.ts are UNCHANGED.
// Once fixed, and once migration 042 (docs/reviews/042_storage_bucket_
// setup.sql) was applied to test-db and the bucket confirmed private by
// direct observation (SELECT public FROM storage.buckets -- false), all
// five cases passed for real against a live database. See the build report
// for the exact command and raw output.

describe('getSignedPhotoUrl — tenant/role isolation (CLAUDE.md §7)', () => {
  let pmAId: string
  let pmBId: string
  let engineerAId: string
  let dailyLogAId: string
  let objectPathA: string

  beforeAll(async () => {
    const db = testClient()
    const fixtures = await ensureTwoTenantFixtures()
    pmAId = fixtures.profileAId
    pmBId = fixtures.profileBId

    // ensureTwoTenantFixtures() claims profileA/B as tenant admins but adds
    // no project_members row at all -- this suite's own PM membership,
    // added here rather than widening the shared fixture helper for a
    // shape only this suite needs.
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

    // The same-tenant, wrong-role caller (migration 027's own role-blind RLS
    // precedent, restated in docs/plans/stage0-storage-setup-plan.md §6) --
    // a plain WhatsApp-only users row (ENG-01 shape, auth_id null), same
    // pattern as test/helpers/db.ts's own ensureMorningEngineer, not an
    // auth.users-backed profile (this caller never needs a real session --
    // getSignedPhotoUrl takes a resolved callerUserId, per its own header).
    const { data: engineer, error: engErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        full_name: 'ZZ Storage Isolation Test Engineer',
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        whatsapp_number: `+19995559${Date.now() % 100000}`,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (engErr || !engineer) throw new Error(`seed engineer failed: ${engErr?.message ?? 'no row'}`)
    engineerAId = engineer.id

    const { error: engMemberErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: engineerAId, role: 'engineer' },
      { onConflict: 'project_id,user_id' },
    )
    if (engMemberErr) throw new Error(`seed engineer membership failed: ${engMemberErr.message}`)

    // One daily_logs row on project A -- getSignedPhotoUrl only ever reads
    // its project_id, so engineer_id/log_date content is otherwise inert
    // to this suite.
    const { data: log, error: logErr } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: pmAId,
        log_date: '2026-09-13',
      })
      .select('id')
      .single<{ id: string }>()
    if (logErr || !log) throw new Error(`seed daily_log failed: ${logErr?.message ?? 'no row'}`)
    dailyLogAId = log.id

    objectPathA = `${TEST_TENANT_A_ID}/${dailyLogAId}/${randomUUID()}.jpg`

    // A real object at that path, so the positive case exercises a genuine
    // Storage read, not just the membership-check half of the function.
    // Requires migration 042's bucket to already exist on the target
    // database -- see this file's own header for why that has not been
    // confirmed in the environment this suite was authored in.
    const { error: uploadErr } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(objectPathA, Buffer.from('test'), { contentType: 'image/jpeg', upsert: true })
    if (uploadErr) throw new Error(`seed object upload failed: ${uploadErr.message}`)
  })

  afterAll(async () => {
    const db = testClient()
    await db.storage.from(PHOTO_BUCKET).remove([objectPathA])
    if (engineerAId) {
      await db.from('project_members').delete().eq('user_id', engineerAId)
      await db.from('users').delete().eq('id', engineerAId)
    }
    await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID)
    await db.from('project_members').delete().in('project_id', [TEST_PROJECT_A_ID, TEST_PROJECT_B_ID])
    await removeTwoTenantFixtures()
  })

  it('a PM on the owning project gets a real signed URL', async () => {
    const url = await getSignedPhotoUrl({ objectPath: objectPathA, callerUserId: pmAId, supabaseClient: testClient() })
    expect(url).not.toBeNull()
    expect(typeof url).toBe('string')
  })

  it('CROSS-TENANT: a PM on a different tenant/project gets null — the core isolation assertion', async () => {
    const url = await getSignedPhotoUrl({ objectPath: objectPathA, callerUserId: pmBId, supabaseClient: testClient() })
    expect(url).toBeNull()
  })

  it('SAME-TENANT, WRONG ROLE: a non-PM on the correct project gets null (migration 027 role-blind precedent)', async () => {
    const url = await getSignedPhotoUrl({ objectPath: objectPathA, callerUserId: engineerAId, supabaseClient: testClient() })
    expect(url).toBeNull()
  })

  it('a malformed object path (wrong segment count) gets null, no query attempted', async () => {
    const url = await getSignedPhotoUrl({ objectPath: 'not-a-real-path', callerUserId: pmAId, supabaseClient: testClient() })
    expect(url).toBeNull()
  })

  it('a syntactically valid path pointing at a nonexistent daily_log_id gets null', async () => {
    const fakePath = `${TEST_TENANT_A_ID}/${randomUUID()}/${randomUUID()}.jpg`
    const url = await getSignedPhotoUrl({ objectPath: fakePath, callerUserId: pmAId, supabaseClient: testClient() })
    expect(url).toBeNull()
  })
})
