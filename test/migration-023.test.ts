import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
  TEST_007_PASSWORD,
  type TwoTenantFixtures,
} from './helpers/db'

// Migration 023 — public.dprs. RLS isolation + constraint suite
// (docs/reviews/023-review-package.md §6).
//
//   T-023-01  *** CENTREPIECE *** cross-project WITHIN one tenant: a PM who is
//             a member of project A1 but NOT A2 (same tenant) sees A1's dprs
//             row and does NOT see A2's. This is the exact gap 019 had to
//             patch on daily_logs, and the whole justification for
//             dprs_select's RLS SCOPING comment. A tenant-wide policy would
//             pass a test that only checked "A2 absent" — so this asserts A1
//             IS present as well, not absence alone (see the note below).
//   T-023-02  cross-tenant: the same PM sees nothing from tenant B's project.
//   T-023-03  anon client sees zero rows (default-deny, not a rejected call —
//             no policy targets anon at all).
//   T-023-04  authenticated cannot INSERT, UPDATE, or DELETE via PostgREST —
//             023's REVOKE, not an RLS WITH CHECK. All three fail at the
//             grant layer (42501) before RLS is even consulted.
//   T-023-05  UNIQUE(project_id, engineer_id, log_date) rejects a duplicate
//             (same engineer twice) — 23505 — AND a second engineer on the
//             same project_id + log_date is now ALLOWED, the intentional
//             behaviour change migration 028 (per-engineer DPR reformat)
//             exists to make possible. Updated 2026-08-14 — the constraint
//             was 2-column (project_id, log_date) when this file was
//             written; 028 widened it to 3-column and the old assertion no
//             longer describes the live schema.
//   T-023-06  CHECK rejects a bad delivery_status and a bad generation_status
//             — 23514, both columns.
//   T-023-07  it.todo — TRUNCATE/REFERENCES/TRIGGER tracked gap (see below).
//
// WHY T-023-01/02 MATTER MORE THAN THEY LOOK: dprs_select's USING clause
//   (tenant_id = get_user_tenant_id() AND EXISTS(project_members ... users
//   ...)) is BYTE-IDENTICAL to daily_log_edits_select (019:128-137) — and
//   grepping test/ turns up no place that ever SELECTs daily_log_edits
//   through a real JWT client; 019's own suite only reaches it indirectly
//   through the correct_daily_log SECURITY DEFINER RPC, which bypasses RLS
//   on write. So T-023-01 is not just proving 023 — it's the first time this
//   nested-EXISTS shape has run under a live authenticated session anywhere
//   in this repo. If it fails, the fix is NOT "adjust 023's policy" — 023's
//   policy is a faithful copy of one already on prod, so a failure here
//   means daily_log_edits has the same problem in production today, and the
//   question becomes what it's actually exposing (or over-restricting).
//
//   The specific failure mode worth naming: dprs_select is a plain policy,
//   NOT SECURITY DEFINER, so `(SELECT id FROM public.users WHERE auth_id =
//   auth.uid())` inside the EXISTS runs AS THE CALLING USER, under
//   users_select's own RLS (auth_id = auth.uid() OR tenant_id =
//   get_user_tenant_id(), 007:216-218) — unlike get_user_tenant_id() itself,
//   which is SECURITY DEFINER and insulated from this. A self-read satisfies
//   auth_id = auth.uid() regardless, and project_members_select is
//   tenant-wide (002:114-116) off the same SECURITY DEFINER function, so
//   static reading of the schema doesn't turn up an obvious lockout path —
//   but that's exactly why this needs to run for real rather than be
//   reasoned about further. A total lockout (PM sees NEITHER A1 nor A2)
//   would satisfy an absence-only assertion perfectly, which is why T-023-01
//   and T-023-02 both assert the present row explicitly, not just the
//   missing one.
//
// Runs against the test-db branch (guarded by test/setup/guard.ts).

const PROJECT_A2_ID = '00000000-0000-4000-a000-00000000023a' // tenant A, non-member
const DPR_A1_ID = '00000000-0000-4000-a000-0000000230a1' // project A1 (member)
const DPR_A2_ID = '00000000-0000-4000-a000-0000000230a2' // project A2 (same tenant, non-member)
const DPR_B1_ID = '00000000-0000-4000-a000-0000000230b1' // project B1 (tenant B)
const LOG_DATE = '2026-09-23' // unused by any other suite
const UNIQUE_TEST_LOG_DATE = '2026-09-24'
const CHECK_TEST_LOG_DATE = '2026-09-25'

function anonClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

let fx: TwoTenantFixtures
let jwtA: SupabaseClient
const anon = anonClient()

async function seedDpr(
  id: string,
  tenantId: string,
  projectId: string,
  logDate: string,
  content: string,
  engineerId: string,
): Promise<void> {
  const db = testClient()
  const { error } = await db.from('dprs').upsert(
    { id, tenant_id: tenantId, project_id: projectId, log_date: logDate, content, engineer_id: engineerId },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seedDpr(${id}) failed: ${error.message}`)
}

async function readContent(id: string): Promise<string | null> {
  const db = testClient()
  const { data, error } = await db.from('dprs').select('content').eq('id', id).single()
  if (error) throw new Error(`readContent(${id}) failed: ${error.message}`)
  return (data as { content: string | null }).content
}

beforeAll(async () => {
  const db = testClient()
  fx = await ensureTwoTenantFixtures()

  // Promote A to PM and make A a member of project A1 only (NOT A2).
  await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
  await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  // Same-tenant project A2 has no membership row for A — the deliberate gap.
  await db.from('projects').upsert(
    { id: PROJECT_A2_ID, tenant_id: TEST_TENANT_A_ID, created_by: fx.profileAId, name: 'ZZ 023 Project A2 (non-member)' },
    { onConflict: 'id' },
  )

  await seedDpr(DPR_A1_ID, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, LOG_DATE, 'dpr content — project A1', fx.profileAId)
  await seedDpr(DPR_A2_ID, TEST_TENANT_A_ID, PROJECT_A2_ID, LOG_DATE, 'dpr content — project A2', fx.profileAId)
  await seedDpr(DPR_B1_ID, TEST_TENANT_B_ID, TEST_PROJECT_B_ID, LOG_DATE, 'dpr content — project B1', fx.profileBId)

  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterAll(async () => {
  const db = testClient()
  await db.from('dprs').delete().in('id', [DPR_A1_ID, DPR_A2_ID, DPR_B1_ID])
  await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID).eq('user_id', fx.profileAId)
  await db.from('projects').delete().eq('id', PROJECT_A2_ID)
  await db.from('users').update({ role: 'admin' }).eq('id', fx.profileAId) // restore shared fixture state
  await removeTwoTenantFixtures()
})

describe('migration 023 — public.dprs', () => {
  it('T-023-01: CENTREPIECE — cross-project within one tenant: sees A1 (member), not A2 (non-member)', async () => {
    const { data, error } = await jwtA
      .from('dprs')
      .select('id')
      .in('id', [DPR_A1_ID, DPR_A2_ID])
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => (r as { id: string }).id).sort()
    // Asserts A1 IS present, not just that A2 is absent — a total lockout
    // (both missing) would satisfy an absence-only check.
    expect(ids).toEqual([DPR_A1_ID])
  })

  it('T-023-02: cross-tenant — sees A1 (own tenant), not B1 (tenant B)', async () => {
    const { data, error } = await jwtA
      .from('dprs')
      .select('id')
      .in('id', [DPR_A1_ID, DPR_B1_ID])
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => (r as { id: string }).id).sort()
    expect(ids).toEqual([DPR_A1_ID])
  })

  it('T-023-03: anon client sees zero rows (default-deny, not a rejected call)', async () => {
    const { data, error } = await anon
      .from('dprs')
      .select('id')
      .in('id', [DPR_A1_ID, DPR_A2_ID, DPR_B1_ID])
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('T-023-04: authenticated cannot INSERT, UPDATE, or DELETE via PostgREST — code 42501, no write path', async () => {
    // 023's REVOKE strips the grant entirely (no INSERT/UPDATE/DELETE policy
    // exists either) — this is a grant-layer denial, before RLS is even
    // consulted, distinct from a WITH CHECK rejection (which would still
    // require the grant to exist). Message wording asserted loosely
    // (/permission denied/i) rather than pinned to exact "table" vs
    // "relation" phrasing, which hasn't been empirically observed for this
    // specific REVOKE shape before writing this test.
    //
    // DELIBERATELY REUSES jwtA (the exact client from T-023-01/02), not a
    // fresh client — 42501 alone doesn't distinguish authenticated from
    // anon here (both are denied INSERT; Postgres's own error hint says
    // "GRANT ... TO anon", which names whichever role actually lacked the
    // privilege and would read identically for either role under test). What
    // proves this session is authenticated, not anon, is T-023-01: only a
    // real authenticated JWT could have returned dprs_select-scoped rows
    // there (T-023-03 shows anon gets an empty array, not an error) — so
    // jwtA returning a real row in T-023-01 is the proof this is genuinely
    // an authenticated session, carried into this test by reusing the same
    // object rather than re-asserted here.
    const insertRes = await jwtA
      .from('dprs')
      .insert({ tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, log_date: '2026-09-26' })
    expect(insertRes.error?.code).toBe('42501')
    expect(insertRes.error?.message).toMatch(/permission denied/i)

    const updateRes = await jwtA.from('dprs').update({ content: 'tampered' }).eq('id', DPR_A1_ID)
    expect(updateRes.error?.code).toBe('42501')
    expect(updateRes.error?.message).toMatch(/permission denied/i)

    const deleteRes = await jwtA.from('dprs').delete().eq('id', DPR_A1_ID)
    expect(deleteRes.error?.code).toBe('42501')
    expect(deleteRes.error?.message).toMatch(/permission denied/i)

    // Negative control: DPR_A1 is untouched despite all three attempts.
    expect(await readContent(DPR_A1_ID)).toBe('dpr content — project A1')
  })

  it('T-023-05: UNIQUE(project_id, engineer_id, log_date) rejects a same-engineer duplicate, but now ALLOWS a second engineer on the same project_id + log_date (migration 028)', async () => {
    const db = testClient()
    const firstId = '00000000-0000-4000-a000-0000000230c1'
    const dupeId = '00000000-0000-4000-a000-0000000230c2'
    const secondEngineerId = '00000000-0000-4000-a000-0000000230c3'
    try {
      const first = await db
        .from('dprs')
        .insert({ id: firstId, tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, log_date: UNIQUE_TEST_LOG_DATE, engineer_id: fx.profileAId })
      expect(first.error).toBeNull()

      // Same (project_id, engineer_id, log_date) — still rejected.
      const dupe = await db
        .from('dprs')
        .insert({ id: dupeId, tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, log_date: UNIQUE_TEST_LOG_DATE, engineer_id: fx.profileAId })
      expect(dupe.error?.code).toBe('23505')

      // Same (project_id, log_date), DIFFERENT engineer_id — now allowed.
      // This is the exact behaviour 028 exists to enable (one report per
      // engineer per project-day, not one per project-day). A composite FK
      // (engineer_id, tenant_id) -> users(id, tenant_id) requires a real
      // same-tenant user id, so this reuses fx.profileBId's OWN tenant's
      // counterpart is wrong — profileBId is tenant B. Use TEST_007_USER_A's
      // own profile is already taken by `first`; seed a second tenant-A user
      // row directly for this purpose instead of borrowing across tenants.
      const secondUser = await db
        .from('users')
        .insert({ id: secondEngineerId, tenant_id: TEST_TENANT_A_ID, full_name: 'ZZ 023 second engineer', role: 'engineer', status: 'active' })
        .select('id')
        .single()
      expect(secondUser.error).toBeNull()

      const secondEngineerDpr = await db
        .from('dprs')
        .insert({ id: '00000000-0000-4000-a000-0000000230c4', tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, log_date: UNIQUE_TEST_LOG_DATE, engineer_id: secondEngineerId })
      expect(secondEngineerDpr.error).toBeNull()

      await db.from('dprs').delete().eq('id', '00000000-0000-4000-a000-0000000230c4')
      await db.from('users').delete().eq('id', secondEngineerId)
    } finally {
      await db.from('dprs').delete().in('id', [firstId, dupeId])
    }
  })

  it('T-023-06: CHECK rejects a bad delivery_status and a bad generation_status', async () => {
    const db = testClient()
    const badDelivery = await db.from('dprs').insert({
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      log_date: CHECK_TEST_LOG_DATE,
      engineer_id: fx.profileAId,
      delivery_status: 'bogus',
    })
    expect(badDelivery.error?.code).toBe('23514')

    const badGeneration = await db.from('dprs').insert({
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      log_date: CHECK_TEST_LOG_DATE,
      engineer_id: fx.profileAId,
      generation_status: 'bogus',
    })
    expect(badGeneration.error?.code).toBe('23514')
  })

  // T-023-07 — TRACKED GAP, not silently absent: TRUNCATE, REFERENCES, and
  // TRIGGER are still held by anon/authenticated on dprs (and every other
  // public table) via Postgres's default-privilege grants — a systemic,
  // pre-existing condition, not a 023 defect (docs/reviews/023-review-package.md
  // §3). None of the three has a PostgREST verb, so none can be exercised or
  // asserted through a supabase-js client — there is no automated way to
  // write this as a real test today. The gap is not hypothetical: §3's SET
  // ROLE anon; TRUNCATE public.dprs demonstration on test-db actually
  // destroyed a seeded row (rows_before=1, rows_after=0), rolled back, not
  // simulated. Closes via migration 024 (sweeps the REVOKE across all 25
  // affected tables) plus a new scripts/lint-migrations.mjs rule requiring
  // that REVOKE alongside every future CREATE TABLE — not via a test in this
  // file, since there is nothing here to assert against.
  it.todo(
    'T-023-07: TRUNCATE/REFERENCES/TRIGGER cannot be tested via PostgREST — see docs/reviews/023-review-package.md §3; closes via migration 024 + lint rule, not a test here',
  )
})
