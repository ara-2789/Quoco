import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures } from './helpers/db'
import { runOwnerSendTrigger } from '@/app/api/cron/owner-send/route'
import { enqueueJob } from '@/lib/queue/jobs'

// Same mocking shape as test/dpr-generate-trigger.test.ts's own header
// comment explains in full -- @sentry/nextjs's named exports are
// non-configurable under ESM, so vi.mock + vi.hoisted is required, not
// stylistic. Both captureMessage (skip-no-owner) and captureException
// (per-project failure isolation) are mocked here, unlike that file,
// since this route uses both.
const { captureMessageMock, captureExceptionMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}))
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  return { ...actual, captureMessage: captureMessageMock, captureException: captureExceptionMock }
})

// Integration tests for runOwnerSendTrigger (app/api/cron/owner-send/
// route.ts) -- the 20:30 IST cron's real logic, built 2026-09-03. Run
// against test-db. Each test creates its OWN project(s) rather than
// reusing the shared TEST_PROJECT_ID fixture, and asserts only on its own
// project's own result -- same discipline as
// test/dpr-generate-trigger.test.ts, since runOwnerSendTrigger scans ALL
// active projects.

const LOG_DATE = '2026-05-01'

async function makeProject(nameSuffix: string, ownerUserId: string | null = null): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: `Owner-send trigger test project ${nameSuffix}`, status: 'active', owner_user_id: ownerUserId })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function makeTestOwner(suffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_ID,
      full_name: `Owner-send trigger test owner ${suffix}`,
      role: 'owner',
      auth_id: null,
      whatsapp_number: null,
      status: 'active',
      notification_email: `zz-owner-send-trigger-${suffix}@quoco.test`,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeTestOwner failed: ${error.message}`)
  return data.id as string
}

async function cleanupProject(projectId: string, ownerUserIds: string[] = []): Promise<void> {
  const db = testClient()
  await db.from('jobs').delete().contains('payload', { project_id: projectId })
  // owner_user_id is a composite FK into users -- clear it before deleting
  // the owner row, otherwise the delete below fails the FK.
  await db.from('projects').update({ owner_user_id: null }).eq('id', projectId)
  await db.from('projects').delete().eq('id', projectId)
  for (const id of ownerUserIds) {
    await db.from('users').delete().eq('id', id)
  }
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('runOwnerSendTrigger', () => {
  it('enqueues one owner_deliver job per eligible (active, owned) project', async () => {
    captureMessageMock.mockClear()
    const ownerAId = await makeTestOwner('a')
    const ownerBId = await makeTestOwner('b')
    const projectAId = await makeProject('eligible-a', ownerAId)
    const projectBId = await makeProject('eligible-b', ownerBId)
    try {
      const db = testClient()
      const results = await runOwnerSendTrigger(db, LOG_DATE)

      const mineA = results.find((r) => r.project_id === projectAId)
      const mineB = results.find((r) => r.project_id === projectBId)
      expect(mineA?.outcome).toBe('enqueued')
      expect(mineB?.outcome).toBe('enqueued')

      const { data: jobsA } = await db.from('jobs').select('payload').eq('type', 'owner_deliver').contains('payload', { project_id: projectAId })
      expect(jobsA?.length).toBe(1)
      expect(jobsA?.[0].payload).toEqual({ project_id: projectAId, log_date: LOG_DATE })

      const { data: jobsB } = await db.from('jobs').select('payload').eq('type', 'owner_deliver').contains('payload', { project_id: projectBId })
      expect(jobsB?.length).toBe(1)
    } finally {
      await cleanupProject(projectAId, [ownerAId])
      await cleanupProject(projectBId, [ownerBId])
    }
  })

  it('skips and warns on an active project with no owner_user_id set', async () => {
    captureMessageMock.mockClear()
    const projectId = await makeProject('no-owner') // owner_user_id defaults to null
    try {
      const db = testClient()
      const results = await runOwnerSendTrigger(db, LOG_DATE)

      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.outcome).toBe('skipped_no_owner')

      expect(captureMessageMock).toHaveBeenCalledWith(
        'owner-send: active project has no owner_user_id set',
        expect.objectContaining({ level: 'warning', extra: expect.objectContaining({ project_id: projectId }) }),
      )

      const { data: jobs } = await db.from('jobs').select('id').eq('type', 'owner_deliver').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(0) // no job enqueued -- not an error, just nothing to do yet
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('does not double-enqueue when a pending owner_deliver job already exists for (project_id, log_date)', async () => {
    const ownerId = await makeTestOwner('dedup')
    const projectId = await makeProject('dedup', ownerId)
    try {
      const db = testClient()
      await enqueueJob('owner_deliver', { project_id: projectId, log_date: LOG_DATE }, db)

      const results = await runOwnerSendTrigger(db, LOG_DATE)
      const mine = results.find((r) => r.project_id === projectId)
      expect(mine?.outcome).toBe('already_queued')

      const { data: jobs } = await db.from('jobs').select('id').eq('type', 'owner_deliver').contains('payload', { project_id: projectId })
      expect(jobs?.length).toBe(1) // still exactly one -- the trigger did not add a second
    } finally {
      await cleanupProject(projectId, [ownerId])
    }
  })

  it('a failure on one project does not prevent the others -- per-project isolation, the deliberate divergence from dpr-generate', async () => {
    captureExceptionMock.mockClear()
    const ownerFailId = await makeTestOwner('fail')
    const ownerOkId = await makeTestOwner('ok')
    const projectFailId = await makeProject('isolation-fail', ownerFailId)
    const projectOkId = await makeProject('isolation-ok', ownerOkId)
    try {
      const db = testClient()
      const results = await runOwnerSendTrigger(db, LOG_DATE, {
        // Injected failure for exactly one project -- same DI shape as
        // owner-deliver-dispatch.ts's own sendEmailFn/sendWhatsAppFn,
        // simulating a real enqueue failure without needing a genuine
        // database-level fault.
        enqueueJobFn: async (type, payload, client) => {
          if ((payload as { project_id: string }).project_id === projectFailId) {
            throw new Error('simulated enqueue failure')
          }
          return enqueueJob(type, payload, client)
        },
      })

      const mineFail = results.find((r) => r.project_id === projectFailId)
      const mineOk = results.find((r) => r.project_id === projectOkId)

      expect(mineFail?.outcome).toBe('failed')
      expect(mineFail?.error).toContain('simulated enqueue failure')
      expect(mineOk?.outcome).toBe('enqueued') // the OTHER project still succeeded

      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ extra: expect.objectContaining({ project_id: projectFailId }) }),
      )

      const { data: jobsOk } = await db.from('jobs').select('id').eq('type', 'owner_deliver').contains('payload', { project_id: projectOkId })
      expect(jobsOk?.length).toBe(1)
      const { data: jobsFail } = await db.from('jobs').select('id').eq('type', 'owner_deliver').contains('payload', { project_id: projectFailId })
      expect(jobsFail?.length).toBe(0) // the failed project's own enqueue never landed
    } finally {
      await cleanupProject(projectFailId, [ownerFailId])
      await cleanupProject(projectOkId, [ownerOkId])
    }
  })
})
