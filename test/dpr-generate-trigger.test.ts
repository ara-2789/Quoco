import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { testClient, TEST_TENANT_ID, TEST_PROJECT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId } from './helpers/db'
import { runDprGenerateTrigger } from '@/app/api/cron/dpr-generate/route'
import { enqueueJob } from '@/lib/queue/jobs'

// @sentry/nextjs's named exports are non-configurable under ESM — vi.spyOn
// throws "Cannot redefine property." vi.mock with importOriginal keeps
// every real export except captureMessage, which becomes a real vi.fn()
// the Q8 test can assert against. vi.hoisted is required, not stylistic —
// vi.mock factories are hoisted above ordinary top-level const
// declarations, so a plain const here throws "Cannot access before
// initialization" the moment the mocked module is first imported.
const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }))
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  return { ...actual, captureMessage: captureMessageMock }
})

// Integration tests for runDprGenerateTrigger — the 8 PM cron's real logic,
// rewired 2026-08-14 to the roster ∪ real-data union
// (docs/dpr-engineer-report-spec.md, plan revision 8, S3/round-3 Q8). Run
// against test-db.
//
// Each test creates its OWN project rather than reusing the shared
// TEST_PROJECT_ID fixture, and asserts only on that project's own result.

const LOG_DATE = '2026-05-01'

async function makeProject(nameSuffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: `Cron trigger test project ${nameSuffix}`, status: 'active' })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function addRosterMember(projectId: string, engineerId: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('project_members').insert({ tenant_id: TEST_TENANT_ID, project_id: projectId, user_id: engineerId, role: 'engineer' })
  if (error) throw new Error(`addRosterMember failed: ${error.message}`)
}

async function makeSecondEngineer(suffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('users')
    .insert({ tenant_id: TEST_TENANT_ID, full_name: `Trigger test engineer ${suffix}`, role: 'engineer', status: 'active', whatsapp_number: `+1999555${suffix}` })
    .select('id')
    .single()
  if (error) throw new Error(`makeSecondEngineer failed: ${error.message}`)
  return data.id as string
}

async function cleanupProject(projectId: string, extraEngineerIds: string[] = []): Promise<void> {
  const db = testClient()
  await db.from('jobs').delete().contains('payload', { project_id: projectId })
  await db.from('dprs').delete().eq('project_id', projectId)
  await db.from('daily_logs').delete().eq('project_id', projectId)
  await db.from('project_members').delete().eq('project_id', projectId)
  await db.from('projects').delete().eq('id', projectId)
  for (const id of extraEngineerIds) {
    await db.from('users').delete().eq('id', id)
  }
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterEach(async () => {
  // runDprGenerateTrigger scans ALL active projects, so every test also
  // touches the shared TEST_PROJECT_ID fixture as a side effect if its
  // roster engineer has no data — clean up any dprs rows AND any
  // dpr_generate jobs it produced (found the hard way: two leftover
  // pending jobs against TEST_PROJECT_ID surfaced during the 028
  // test-db rehearsal — this file's own dprs cleanup existed, the jobs
  // cleanup did not).
  await testClient().from('dprs').delete().eq('project_id', TEST_PROJECT_ID).eq('log_date', LOG_DATE)
  await testClient().from('jobs').delete().eq('type', 'dpr_generate').contains('payload', { project_id: TEST_PROJECT_ID, log_date: LOG_DATE })
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('runDprGenerateTrigger', () => {
  it('SET 2 (real data) — an engineer with daily_logs but NO project_members row is still enqueued (S3 real-data-wins)', async () => {
    const projectId = await makeProject('real-data-only')
    try {
      const db = testClient()
      // Deliberately no project_members row for this engineer on this
      // project — only real data (S3's union-only case).
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.engineers_enqueued).toBe(1)

      const { data: jobs } = await db.from('jobs').select('payload').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(1)
      expect((jobs?.[0].payload as { engineer_id: string }).engineer_id).toBe(testEngineerId())
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('Q8 — an active project resolving to ZERO eligible engineers emits a Sentry warning and writes no dprs row', async () => {
    captureMessageMock.mockClear()
    const projectId = await makeProject('zero-eligible')
    try {
      const db = testClient()
      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.engineers_enqueued).toBe(0)

      expect(captureMessageMock).toHaveBeenCalledWith(
        'dpr-generate: active project resolved to zero eligible engineers',
        expect.objectContaining({ extra: expect.objectContaining({ project_id: projectId }) }),
      )

      const { data: dpr } = await db.from('dprs').select('id').eq('project_id', projectId).eq('log_date', LOG_DATE).maybeSingle()
      expect(dpr).toBeNull() // S4 — accepted gap, no project-level marker row
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('B2 — N roster engineers on one project produce N enqueued jobs, not 1 (the dedup containment-match fix)', async () => {
    const projectId = await makeProject('n-engineers')
    const secondEngineerId = await makeSecondEngineer('n1')
    try {
      const db = testClient()
      await addRosterMember(projectId, testEngineerId())
      await addRosterMember(projectId, secondEngineerId)

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.engineers_enqueued).toBe(2)

      const { data: jobs } = await db.from('jobs').select('payload').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      const engineerIds = (jobs ?? []).map((j) => (j.payload as { engineer_id: string }).engineer_id).sort()
      expect(engineerIds).toEqual([testEngineerId(), secondEngineerId].sort())
    } finally {
      await cleanupProject(projectId, [secondEngineerId])
    }
  })

  it('DEDUP — an already-pending job for (project_id, engineer_id, log_date) is not enqueued twice', async () => {
    const projectId = await makeProject('dedup')
    try {
      const db = testClient()
      await addRosterMember(projectId, testEngineerId())
      await enqueueJob('dpr_generate', { project_id: projectId, engineer_id: testEngineerId(), log_date: LOG_DATE }, db)

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.engineers_enqueued).toBe(0)
      expect(mine?.engineers_already_queued).toBe(1)

      const { data: jobs } = await db.from('jobs').select('id').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(1) // still exactly one — the trigger did not add a second
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('DEDUP does not cross-collapse engineers — engineer 2 is still enqueued when only engineer 1 has a pending job (the B2 bug, proven fixed)', async () => {
    const projectId = await makeProject('dedup-no-cross-collapse')
    const secondEngineerId = await makeSecondEngineer('n2')
    try {
      const db = testClient()
      await addRosterMember(projectId, testEngineerId())
      await addRosterMember(projectId, secondEngineerId)
      await enqueueJob('dpr_generate', { project_id: projectId, engineer_id: testEngineerId(), log_date: LOG_DATE }, db)

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      // Engineer 1 already queued, engineer 2 genuinely new.
      expect(mine?.engineers_already_queued).toBe(1)
      expect(mine?.engineers_enqueued).toBe(1)

      const { data: jobs } = await db.from('jobs').select('payload').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(2)
    } finally {
      await cleanupProject(projectId, [secondEngineerId])
    }
  })

  it('a non-active project (status != active) is never in the eligible set at all', async () => {
    const projectId = await makeProject('on-hold')
    try {
      const db = testClient()
      await db.from('projects').update({ status: 'on_hold' }).eq('id', projectId)
      await addRosterMember(projectId, testEngineerId())

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine).toBeUndefined() // never appears — it wasn't selected at all
    } finally {
      await cleanupProject(projectId)
    }
  })
})
