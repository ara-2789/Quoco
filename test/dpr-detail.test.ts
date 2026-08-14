import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
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
import { getDprDetail } from '../app/(dashboard)/dprs/[id]/page'

// DASH-04 report detail view — getDprDetail (the extracted, directly
// testable fetch behind app/(dashboard)/dprs/[id]/page.tsx). Verifies the
// route goes through dprs_select's RLS exactly as migration-023.test.ts
// already proved the policy itself does (T-023-01/02) — this file exercises
// the SAME isolation guarantee through the actual function the page calls,
// not a re-derivation of the policy test. Self-contained fixtures (own
// non-member project, own ids/dates) so this file doesn't depend on
// migration-023.test.ts's run order.
//
//   T-DETAIL-01  member sees their own project's row, content included.
//   T-DETAIL-02  same-tenant, non-member project -> null (not a thrown
//                error) — proves the route can't distinguish "doesn't
//                exist" from "exists, no access" by anything OTHER than
//                the return value, which is the point: getDprDetail's own
//                comment states both cases collapse to null on purpose.
//   T-DETAIL-03  cross-tenant -> null, same shape as T-DETAIL-02.
//   T-DETAIL-04  content IS NULL (not yet generated) -> row returned with
//                content: null, NOT null itself — "not generated yet" must
//                stay distinguishable from "not found."
//   T-DETAIL-05  the honest-gap case: content holding real not_captured/
//                suppressed-shaped text (the render.ts output shape) comes
//                back byte-identical, unmodified — the page adds no
//                formatting logic of its own to drift from render.ts.

const PROJECT_A2_ID = '00000000-0000-4000-a000-0000000d4a02' // tenant A, non-member
const DPR_A1_ID = '00000000-0000-4000-a000-0000000d4a11'
const DPR_A2_ID = '00000000-0000-4000-a000-0000000d4a12'
const DPR_B1_ID = '00000000-0000-4000-a000-0000000d4b11'
const DPR_NULL_ID = '00000000-0000-4000-a000-0000000d4e11'
const DPR_GAP_ID = '00000000-0000-4000-a000-0000000d4f11'

const LOG_DATE_A1 = '2026-10-11'
const LOG_DATE_A2 = '2026-10-12'
const LOG_DATE_B1 = '2026-10-13'
const LOG_DATE_NULL = '2026-10-14'
const LOG_DATE_GAP = '2026-10-15'

// A representative slice of render.ts's actual output shape (renderContent) —
// not the full function's output, but the same collapse phrasing it produces
// for a suppressed manpower section and a wholly not-captured equipment line,
// so this test proves those exact phrases survive the fetch unchanged.
const HONEST_GAP_CONTENT = [
  'EXECUTION OUTPUT',
  'Slab pour completed on grid line C3-C5.',
  '  - Slab pour: 45 sqm',
  '',
  'MANPOWER UTILISATION',
  '  2 engineers reported manpower separately for this project today, so the figures are not combined.',
  '',
  'EQUIPMENT UTILISATION',
  '  - JCB: Not captured today.',
  '',
  'ACCOUNTABILITY',
  '  All engineers submitted both check-ins today.',
].join('\n')

let fx: TwoTenantFixtures
let jwtA: SupabaseClient

async function seedDpr(
  id: string,
  tenantId: string,
  projectId: string,
  logDate: string,
  content: string | null,
  engineerId: string,
): Promise<void> {
  const db = testClient()
  const { error } = await db.from('dprs').upsert(
    { id, tenant_id: tenantId, project_id: projectId, log_date: logDate, content, engineer_id: engineerId },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seedDpr(${id}) failed: ${error.message}`)
}

beforeAll(async () => {
  const db = testClient()
  fx = await ensureTwoTenantFixtures()

  await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
  await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  await db.from('projects').upsert(
    { id: PROJECT_A2_ID, tenant_id: TEST_TENANT_A_ID, created_by: fx.profileAId, name: 'ZZ DPR-detail Project A2 (non-member)' },
    { onConflict: 'id' },
  )

  await seedDpr(DPR_A1_ID, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, LOG_DATE_A1, 'dpr content — project A1', fx.profileAId)
  await seedDpr(DPR_A2_ID, TEST_TENANT_A_ID, PROJECT_A2_ID, LOG_DATE_A2, 'dpr content — project A2', fx.profileAId)
  await seedDpr(DPR_B1_ID, TEST_TENANT_B_ID, TEST_PROJECT_B_ID, LOG_DATE_B1, 'dpr content — project B1', fx.profileBId)
  await seedDpr(DPR_NULL_ID, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, LOG_DATE_NULL, null, fx.profileAId)
  await seedDpr(DPR_GAP_ID, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, LOG_DATE_GAP, HONEST_GAP_CONTENT, fx.profileAId)

  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterAll(async () => {
  const db = testClient()
  await db.from('dprs').delete().in('id', [DPR_A1_ID, DPR_A2_ID, DPR_B1_ID, DPR_NULL_ID, DPR_GAP_ID])
  await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID).eq('user_id', fx.profileAId)
  await db.from('projects').delete().eq('id', PROJECT_A2_ID)
  await db.from('users').update({ role: 'admin' }).eq('id', fx.profileAId)
  await removeTwoTenantFixtures()
})

describe('getDprDetail (DASH-04 detail route)', () => {
  it('T-DETAIL-01: member sees their own project row, content included', async () => {
    const dpr = await getDprDetail(jwtA, DPR_A1_ID)
    expect(dpr).not.toBeNull()
    expect(dpr?.content).toBe('dpr content — project A1')
  })

  it('T-DETAIL-02: same-tenant non-member project -> null, not an error', async () => {
    const dpr = await getDprDetail(jwtA, DPR_A2_ID)
    expect(dpr).toBeNull()
  })

  it('T-DETAIL-03: cross-tenant -> null, same shape as non-member', async () => {
    const dpr = await getDprDetail(jwtA, DPR_B1_ID)
    expect(dpr).toBeNull()
  })

  it('T-DETAIL-04: content IS NULL -> row returned (not conflated with not-found)', async () => {
    const dpr = await getDprDetail(jwtA, DPR_NULL_ID)
    expect(dpr).not.toBeNull()
    expect(dpr?.content).toBeNull()
  })

  it('T-DETAIL-05: honest-gap content (suppressed/not-captured phrasing) survives byte-identical', async () => {
    const dpr = await getDprDetail(jwtA, DPR_GAP_ID)
    expect(dpr?.content).toBe(HONEST_GAP_CONTENT)
    expect(dpr?.content).toContain('Not captured today.')
    expect(dpr?.content).toContain('so the figures are not combined.')
  })
})
