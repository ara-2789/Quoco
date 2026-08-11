import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { testClient, TEST_TENANT_ID, TEST_PROJECT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId } from './helpers/db'
import { runDprGenerateTrigger } from '@/app/api/cron/dpr-generate/route'
import { enqueueJob } from '@/lib/queue/jobs'

// Integration tests for runDprGenerateTrigger (the 8 PM cron's real logic,
// extracted from GET the same way handleWebhookPost is extracted from
// POST). Run against test-db.
//
// Each test creates its OWN project rather than reusing the shared
// TEST_PROJECT_ID fixture, and asserts only on that project's own result
// (never on the full results array's length) — test-db's `projects` table
// can carry other active fixtures from unrelated test files, and
// runDprGenerateTrigger genuinely queries ALL active projects by design.
// Asserting exhaustively here would couple this file to global test-db
// state it doesn't own.

const LOG_DATE = '2026-05-01'

async function makeProject(nameSuffix: string, opts: { ownerUserId?: string | null } = {}): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({
      tenant_id: TEST_TENANT_ID,
      name: `Cron trigger test project ${nameSuffix}`,
      status: 'active',
      owner_user_id: opts.ownerUserId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()
  await db.from('jobs').delete().contains('payload', { project_id: projectId })
  await db.from('dprs').delete().eq('project_id', projectId)
  await db.from('daily_logs').delete().eq('project_id', projectId)
  await db.from('projects').delete().eq('id', projectId)
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

// runDprGenerateTrigger scans ALL active projects, so every test below
// also touches the shared TEST_PROJECT_ID fixture as a side effect (it has
// no daily_logs row for LOG_DATE, so the trigger writes it a
// skipped_no_data dprs row each time) — clean that up after every test, or
// it outlives this file and blocks removeMorningFixtures' own project
// delete via dprs_project_id_fkey (found by running this file, not
// anticipated).
afterEach(async () => {
  await testClient().from('dprs').delete().eq('project_id', TEST_PROJECT_ID).eq('log_date', LOG_DATE)
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('runDprGenerateTrigger', () => {
  it('ELIGIBILITY — a project with NO owner_user_id is still eligible (owner presence decides delivery, not generation)', async () => {
    const projectId = await makeProject('no-owner', { ownerUserId: null })
    try {
      const db = testClient()
      // Give it a daily_logs row so it's not zero-data — isolates the
      // eligibility question from the DPR-17 question.
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.action).toBe('enqueued')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('DPR-17 — a project with zero daily_logs rows for the date is skipped, not enqueued', async () => {
    const projectId = await makeProject('zero-data')
    try {
      const db = testClient()
      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.action).toBe('skipped_no_data')

      const { data: dpr } = await db
        .from('dprs')
        .select('delivery_status, generation_status')
        .eq('project_id', projectId)
        .eq('log_date', LOG_DATE)
        .maybeSingle()
      expect(dpr?.delivery_status).toBe('skipped_no_data')
      expect(dpr?.generation_status).toBe('idle')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('DEDUP — a project with an already-pending dpr_generate job for this exact (project_id, log_date) is not enqueued twice', async () => {
    const projectId = await makeProject('dedup')
    try {
      const db = testClient()
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })
      await enqueueJob('dpr_generate', { project_id: projectId, log_date: LOG_DATE }, db)

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.action).toBe('already_queued')

      const { data: jobs } = await db.from('jobs').select('id').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(1) // still exactly one — the trigger did not add a second
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('a project WITH data and no existing job is enqueued exactly once', async () => {
    const projectId = await makeProject('happy-path')
    try {
      const db = testClient()
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.action).toBe('enqueued')

      const { data: jobs } = await db.from('jobs').select('id, payload').eq('type', 'dpr_generate').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(1)
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('a non-active project (status != active) is never in the eligible set at all', async () => {
    const projectId = await makeProject('on-hold')
    try {
      const db = testClient()
      await db.from('projects').update({ status: 'on_hold' }).eq('id', projectId)
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      const results = await runDprGenerateTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine).toBeUndefined() // never appears — it wasn't selected at all
    } finally {
      await cleanupProject(projectId)
    }
  })
})
