import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §3/§8). RLS/grants
// verification for `hindrance_photos` (migration 044). NOT the boundary-
// agreement shape (test/photo-access-boundary-agreement.test.ts) -- that
// exists to catch two independently-encoded boundaries (an RLS policy AND
// a TS access function) drifting apart. `hindrance_photos` has no TS-side
// signed-URL reader this stage (docs/plans/stage2-hindrance-photos-
// plan.md §7 -- that's stage 5, a PM dashboard surface not built here) --
// there is only ONE boundary to test, the RLS policy itself, exercised
// directly via a real authenticated session (jwtClient), same fixture
// shape test/storage-photo-access.test.ts already established.
//
// Same "service_role must be checked explicitly, not just anon/
// authenticated" standing rule this project has already been bitten by
// twice (dpr_versions, outbound_sends round 1) -- the negative grants
// matrix below is a real `has_table_privilege` probe, not an assumption
// from reading the migration file.

describe('hindrance_photos — RLS policy (CLAUDE.md §7 cross-tenant isolation)', () => {
  let pmAId: string
  let pmBId: string
  let hindranceAId: string
  let photoAId: string

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

    const { data: hindrance, error: hindranceErr } = await db
      .from('hindrances')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        reported_by: pmAId,
        description: 'ZZ RLS test hindrance',
        timing: 'active',
        submitted_via: 'whatsapp_adhoc',
      })
      .select('id')
      .single<{ id: string }>()
    if (hindranceErr || !hindrance) throw new Error(`seed hindrance failed: ${hindranceErr?.message ?? 'no row'}`)
    hindranceAId = hindrance.id

    const { data: photo, error: photoErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        hindrance_id: hindranceAId,
        photo_url: `${TEST_TENANT_A_ID}/hindrance/${hindranceAId}/${randomUUID()}.jpg`,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (photoErr || !photo) throw new Error(`seed hindrance_photos row failed: ${photoErr?.message ?? 'no row'}`)
    photoAId = photo.id
  })

  afterAll(async () => {
    const db = testClient()
    await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceAId)
    await db.from('hindrances').delete().eq('id', hindranceAId)
    await db.from('project_members').delete().in('project_id', [TEST_PROJECT_A_ID, TEST_PROJECT_B_ID])
    await removeTwoTenantFixtures()
  })

  it('PM on the owning project (tenant A) CAN select the photo row', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    const { data, error } = await clientA.from('hindrance_photos').select('id').eq('id', photoAId).maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(photoAId)
  })

  it('PM on a DIFFERENT tenant (tenant B) CANNOT select tenant A\'s photo row -- cross-tenant isolation', async () => {
    const clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)
    const { data, error } = await clientB.from('hindrance_photos').select('id').eq('id', photoAId).maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

// STATIC SOURCE GUARD, same technique/family as test/unit/no-app-delete-
// invariant.test.ts -- the Supabase JS/PostgREST client has no general
// "run arbitrary SQL" entry point, so a live `has_table_privilege()` probe
// (the actual evidence, pasted raw in docs/reviews/044-review-package.md,
// run directly via `supabase db query --linked`) cannot be re-run inside
// this vitest suite. What CAN be asserted here, and kept honest on every
// future edit to the migration file, is the SHAPE of the grant statements
// themselves: REVOKE ALL first (so nothing leaks by omission -- the exact
// gap 043's own external review found: a subtractive REVOKE naming only
// four of six non-SELECT/USAGE privileges left REFERENCES/TRIGGER live),
// then an explicit, narrow GRANT-back that never includes DELETE,
// TRUNCATE, REFERENCES, or TRIGGER for service_role -- the standing rule
// this project has now found violated twice (dpr_versions, outbound_sends
// round 1).
describe('hindrance_photos — grant statements (static guard on the migration file itself)', () => {
  // A migration file lives in docs/reviews/ while held, then moves into
  // supabase/migrations/ at apply time (CLAUDE.md's "a migration file enters
  // supabase/migrations/ when it is being applied, not when it is written"
  // rule) -- 044 made exactly that move once it was applied to prod. A path
  // hardcoded to either location breaks the moment the file crosses from one
  // to the other; check both so this test survives the promotion instead of
  // needing its own follow-up fix.
  const CANDIDATE_PATHS = [
    join(__dirname, '..', 'supabase', 'migrations', '044_hindrance_photos.sql'),
    join(__dirname, '..', 'docs', 'reviews', '044_hindrance_photos.sql'),
  ]
  const migrationPath = CANDIDATE_PATHS.find((p) => existsSync(p))
  if (!migrationPath) {
    throw new Error(
      `044_hindrance_photos.sql not found in any expected location: ${CANDIDATE_PATHS.join(', ')}`
    )
  }
  const sql = readFileSync(migrationPath, 'utf8')

  it('REVOKEs ALL from authenticated/anon/service_role before granting anything back -- no privilege can leak by omission', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.hindrance_photos FROM authenticated, anon, service_role;/)
  })

  it('service_role is granted ONLY SELECT, INSERT, UPDATE -- never DELETE, TRUNCATE, REFERENCES, or TRIGGER', () => {
    const grantMatch = sql.match(/GRANT ([\w, ]+) ON public\.hindrance_photos TO service_role;/)
    expect(grantMatch).not.toBeNull()
    const grantedPrivileges = grantMatch![1].split(',').map((p) => p.trim())
    expect(grantedPrivileges.sort()).toEqual(['INSERT', 'SELECT', 'UPDATE'])
    for (const forbidden of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      expect(grantedPrivileges).not.toContain(forbidden)
    }
  })

  it('authenticated is granted ONLY SELECT', () => {
    const grantMatch = sql.match(/GRANT ([\w, ]+) ON public\.hindrance_photos TO authenticated;/)
    expect(grantMatch).not.toBeNull()
    expect(grantMatch![1].trim()).toBe('SELECT')
  })

  it('anon receives no explicit GRANT statement at all', () => {
    expect(sql).not.toMatch(/GRANT [\w, ]+ ON public\.hindrance_photos TO anon;/)
  })
})
