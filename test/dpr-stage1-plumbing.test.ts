import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId } from './helpers/db'
import { resolveCheckInStatus } from '@/lib/dpr/dispatch'
import { resolveProjectManagerName } from '@/lib/dpr/project-manager'

// Integration tests for Stage 1 of the DPR format redesign
// (docs/plans/dpr-format-redesign.md) -- the two new reads
// (daily_logs.attendance on resolveCheckInStatus, and the new
// project_members role='pm' lookup), against real test-db. Neither read
// is consumed by any render path yet (Stage A is deliberately plumbing
// only) -- these tests exercise the reads directly, the same reason
// resolveCheckInStatus is now exported.

const LOG_DATE = '2026-05-03'

async function makeProject(nameSuffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: `dpr stage1 plumbing test project ${nameSuffix}`, status: 'active' })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function addToProject(projectId: string, userId: string, role: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('project_members').insert({ tenant_id: TEST_TENANT_ID, project_id: projectId, user_id: userId, role })
  if (error) throw new Error(`addToProject failed: ${error.message}`)
}

async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()
  await db.from('daily_logs').delete().eq('project_id', projectId)
  await db.from('project_members').delete().eq('project_id', projectId)
  await db.from('projects').delete().eq('id', projectId)
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('resolveCheckInStatus — attendance read (Stage 1)', () => {
  it('returns attendance: null when no daily_logs row exists (silent engineer)', async () => {
    const db = testClient()
    const projectId = await makeProject('attendance-no-row')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      const result = await resolveCheckInStatus(
        db,
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        { morning: 'not_received', evening: 'not_received' },
      )
      expect(result.attendance).toBeNull()
    } finally {
      await cleanupProject(projectId)
    }
  })

  it("returns attendance: 'present' when the row says so", async () => {
    const db = testClient()
    const projectId = await makeProject('attendance-present')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        attendance: 'present',
      })
      const result = await resolveCheckInStatus(
        db,
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        { morning: 'complete', evening: 'not_received' },
      )
      expect(result.attendance).toBe('present')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it("returns attendance: 'absent' -- and, as of Stage 4, classifies morning as not_applicable/kind:'not_on_site', regardless of morning's own completeness value", async () => {
    const db = testClient()
    const projectId = await makeProject('attendance-absent')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        attendance: 'absent',
        is_holiday: false,
      })
      // Stage 4 (2026-09-11, docs/plans/dpr-format-redesign.md §8/§9):
      // deliberately pass morning: 'complete' here -- the real shape a
      // genuinely absent day produces (morning_submitted_at is set,
      // deriveHalfCompleteness reads that alone as 'complete') -- to prove
      // the attendance='absent' override ignores morning's own
      // completeness value entirely and still classifies not_on_site.
      const result = await resolveCheckInStatus(
        db,
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        { morning: 'complete', evening: 'not_received' },
      )
      expect(result.attendance).toBe('absent')
      expect(result.morning).toEqual({ status: 'not_applicable', reason: 'not on site today', kind: 'not_on_site' })
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('attendance: \'absent\' does NOT affect evening -- a real evening check-in still resolves normally, independent of morning', async () => {
    const db = testClient()
    const projectId = await makeProject('attendance-absent-evening-real')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        attendance: 'absent',
        is_holiday: false,
      })
      const result = await resolveCheckInStatus(
        db,
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        { morning: 'complete', evening: 'complete' },
      )
      expect(result.morning.kind).toBe('not_on_site')
      expect(result.evening).toEqual({ status: 'complete' })
    } finally {
      await cleanupProject(projectId)
    }
  })

  it("returns attendance: 'site_holiday' on the existing holiday branch -- consistent with is_holiday's own overlay", async () => {
    const db = testClient()
    const projectId = await makeProject('attendance-site-holiday')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        attendance: 'site_holiday',
        is_holiday: true,
        holiday_reason: 'Local festival',
      })
      const result = await resolveCheckInStatus(
        db,
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        { morning: 'not_received', evening: 'not_received' },
      )
      expect(result.attendance).toBe('site_holiday')
      expect(result.morning.kind).toBe('holiday')
    } finally {
      await cleanupProject(projectId)
    }
  })
})

describe('resolveProjectManagerName (Stage 1)', () => {
  it('returns null when the project has no role=\'pm\' member', async () => {
    const db = testClient()
    const projectId = await makeProject('no-pm')
    try {
      const name = await resolveProjectManagerName(db, projectId)
      expect(name).toBeNull()
    } finally {
      await cleanupProject(projectId)
    }
  })

  it("returns the PM's full_name for the 1:1 case", async () => {
    const db = testClient()
    const projectId = await makeProject('one-pm')
    const { data: pmUser, error } = await db
      .from('users')
      .insert({ tenant_id: TEST_TENANT_ID, full_name: 'ZZ Test PM (stage1 plumbing)', role: 'pm', status: 'active', auth_id: null })
      .select('id')
      .single()
    if (error || !pmUser) throw new Error(`pm user insert failed: ${error?.message ?? 'no row'}`)
    try {
      await addToProject(projectId, pmUser.id as string, 'pm')
      const name = await resolveProjectManagerName(db, projectId)
      expect(name).toBe('ZZ Test PM (stage1 plumbing)')
    } finally {
      await cleanupProject(projectId)
      await db.from('users').delete().eq('id', pmUser.id as string)
    }
  })

  it('does not pick up a non-PM member for the same project', async () => {
    const db = testClient()
    const projectId = await makeProject('no-pm-only-engineer')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId, 'engineer')
      const name = await resolveProjectManagerName(db, projectId)
      expect(name).toBeNull()
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('a second PM row does not throw -- deterministic first-by-created_at, per the design doc §5 (Sentry-warning assertion covered separately, test/unit/project-manager.test.ts, since this suite does not mock Sentry)', async () => {
    const db = testClient()
    const projectId = await makeProject('two-pms')
    const { data: pm1, error: e1 } = await db
      .from('users')
      .insert({ tenant_id: TEST_TENANT_ID, full_name: 'ZZ Test PM One (stage1 plumbing)', role: 'pm', status: 'active', auth_id: null })
      .select('id')
      .single()
    if (e1 || !pm1) throw new Error(`pm1 insert failed: ${e1?.message ?? 'no row'}`)
    const { data: pm2, error: e2 } = await db
      .from('users')
      .insert({ tenant_id: TEST_TENANT_ID, full_name: 'ZZ Test PM Two (stage1 plumbing)', role: 'pm', status: 'active', auth_id: null })
      .select('id')
      .single()
    if (e2 || !pm2) throw new Error(`pm2 insert failed: ${e2?.message ?? 'no row'}`)
    try {
      await addToProject(projectId, pm1.id as string, 'pm')
      await addToProject(projectId, pm2.id as string, 'pm')
      const name = await resolveProjectManagerName(db, projectId)
      // Deterministic (first-created), not a throw -- confirms the
      // ambiguity degrades to "one name, a Sentry warning" rather than
      // breaking generation.
      expect(name).toBe('ZZ Test PM One (stage1 plumbing)')
    } finally {
      await cleanupProject(projectId)
      await db.from('users').delete().in('id', [pm1.id as string, pm2.id as string])
    }
  })
})
