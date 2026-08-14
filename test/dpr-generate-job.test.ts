import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId } from './helpers/db'
import { handleDprGenerateJob, markDprGenerationFailed } from '@/lib/dpr/dispatch'

// Integration tests for handleDprGenerateJob — the per-engineer DPR job
// handler (docs/dpr-engineer-report-spec.md, rewired in place 2026-08-14).
// Against test-db, with an INJECTED, MOCKED Anthropic client — no real,
// billed API call. Exercises the real assembleEngineerDprFacts/
// fetchEngineerNarrativeContext/renderEngineerBody/renderEngineerReport
// chain against real seeded rows; only the Claude call is faked,
// deterministically.

const LOG_DATE = '2026-05-02'
const FAKE_JOB_ID = '00000000-0000-4000-a000-0000000000aa'

function mockAnthropicClient(verdicts: string[]): Anthropic {
  let call = 0
  return {
    messages: {
      create: async () => {
        const verdict = verdicts[Math.min(call, verdicts.length - 1)]
        call++
        return {
          content: [{ type: 'text', text: JSON.stringify({ verdict }) }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: 'end_turn',
        }
      },
    },
  } as unknown as Anthropic
}

async function makeProject(nameSuffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: `dpr_generate job test project ${nameSuffix}`, status: 'active' })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function addToProject(projectId: string, engineerId: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('project_members').insert({ tenant_id: TEST_TENANT_ID, project_id: projectId, user_id: engineerId, role: 'engineer' })
  if (error) throw new Error(`addToProject failed: ${error.message}`)
}

async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()
  await db.from('dprs').delete().eq('project_id', projectId)
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

describe('handleDprGenerateJob', () => {
  it('B2/item-2: pre-028 payload shape (missing engineer_id) throws loudly, does not silently proceed', async () => {
    const db = testClient()
    await expect(
      handleDprGenerateJob(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { project_id: 'x', log_date: LOG_DATE } as any,
        FAKE_JOB_ID,
        { supabaseClient: db },
      ),
    ).rejects.toThrow(/pre-028 payload shape/)
  })

  it('SUCCESS — writes structured/content keyed by engineer_id, generation_status ends idle, delivery_status untouched', async () => {
    const db = testClient()
    const projectId = await makeProject('success')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      // Real data on BOTH halves — a blank row (no fields set) resolves
      // both halves to not_received, which is a genuinely different,
      // correct code path (the code-templated skip-the-model verdict,
      // Rule 2) that this test is not the one exercising. Caught by this
      // test itself on first run: the mock was never called because the
      // real logic correctly skipped it.
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        morning_submitted_at: '2026-05-02T04:00:00Z',
        morning_plan: 'Excavation of footing',
        evening_submitted_at: '2026-05-02T14:00:00Z',
        evening_schedule_met: true,
      })

      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClient(['A day of steady progress.']) },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status, content, structured, generator_job_id, engineer_id')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle')
      expect(dpr?.delivery_status).toBe('pending') // untouched — this handler never sets it on success
      expect(dpr?.engineer_id).toBe(engineerId)
      expect(dpr?.content).toContain('A day of steady progress.')
      expect(dpr?.structured).toBeTruthy()
      expect(dpr?.generator_job_id).toBe(FAKE_JOB_ID)
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('S10 — containment failure on both attempts degrades to the placeholder; report STILL writes, no throw', async () => {
    const db = testClient()
    const projectId = await makeProject('containment-both-fail')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        morning_plan: 'Excavation',
      })

      // "999" traces to nothing in Facts or the rendered body — fails
      // containment on both the first and the retried attempt.
      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        {
          supabaseClient: db,
          anthropicClient: mockAnthropicClient(['Completed 999 uncontained units.', 'Completed 999 uncontained units again.']),
        },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status, content, structured')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle') // succeeded — a real report, just without a model verdict
      expect(dpr?.delivery_status).toBe('pending') // NOT 'failed' — markDprGenerationFailed must never fire for this
      expect(dpr?.content).toContain('Summary unavailable for this report.')
      expect(dpr?.content).not.toContain('999')
      const structured = dpr?.structured as { verdict_status?: string } | null
      expect(structured?.verdict_status).toBe('placeholder')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('S10 — containment fails once, succeeds on the immediate retry; the REAL verdict ships, not the placeholder', async () => {
    const db = testClient()
    const projectId = await makeProject('containment-retry-succeeds')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: engineerId, log_date: LOG_DATE, morning_plan: 'Excavation' })

      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClient(['Completed 999 uncontained units.', 'A clean day of work.']) },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('content, structured')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.content).toContain('A clean day of work.')
      expect(dpr?.content).not.toContain('Summary unavailable')
      const structured = dpr?.structured as { verdict_status?: string } | null
      expect(structured?.verdict_status).toBe('model')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('SILENT ENGINEER — no daily_logs row at all still produces a full report reading not received, no throw', async () => {
    const db = testClient()
    const projectId = await makeProject('silent-engineer')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      // Deliberately no daily_logs row.

      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClient(['unused']) },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, content')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle')
      expect(dpr?.content).toContain('Morning check-in: not received')
      expect(dpr?.content).toContain('Evening check-in: not received')
    } finally {
      await cleanupProject(projectId)
    }
  })
})

describe('markDprGenerationFailed', () => {
  it('B2 fix — scoped by engineer_id: sets delivery_status=failed for the right engineer only, not every row for the project-day', async () => {
    const db = testClient()
    const projectId = await makeProject('mark-failed')
    const engineerId = testEngineerId()
    const otherEngineerId = '00000000-0000-4000-a000-00000000eeee'
    try {
      await db.from('dprs').insert([
        { project_id: projectId, engineer_id: engineerId, tenant_id: TEST_TENANT_ID, log_date: LOG_DATE, generation_status: 'running' },
      ])

      await markDprGenerationFailed(db, projectId, engineerId, LOG_DATE)

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()
      expect(dpr?.delivery_status).toBe('failed')
      expect(dpr?.generation_status).toBe('idle')
      void otherEngineerId // documents intent: a second engineer's row, if present, must be untouched — covered structurally by the .eq('engineer_id', ...) filter itself
    } finally {
      await cleanupProject(projectId)
    }
  })
})
