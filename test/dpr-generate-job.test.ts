import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId } from './helpers/db'
import { handleDprGenerateJob, markDprGenerationFailed } from '@/lib/dpr/dispatch'
import { DprValidationError } from '@/lib/dpr/generate'

// Integration tests for handleDprGenerateJob (Phase 3) against test-db,
// with an INJECTED, MOCKED Anthropic client — no real, billed API call.
// Exercises the real assembleDprFacts/fetchNarrativeContext/
// assembleAccountability/renderDpr chain against real seeded rows; only
// the Claude call itself is faked, deterministically.

const LOG_DATE = '2026-05-02'
const FAKE_JOB_ID = '00000000-0000-4000-a000-0000000000aa'

function mockAnthropicClient(judgment: Record<string, unknown>): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify(judgment) }],
        usage: { input_tokens: 111, output_tokens: 42 },
        stop_reason: 'end_turn',
      }),
    },
  } as unknown as Anthropic
}

const VALID_BLANK_JUDGMENT = {
  execution_narrative: 'No work was reported today.',
  execution_data_status: 'not_captured',
  schedule_miss_reason_note: '',
  schedule_data_status: 'not_captured',
  manpower_idle_reason_note: '',
  manpower_data_status: 'not_captured',
  equipment_items: [],
  equipment_data_status: 'not_captured',
  tomorrows_plan_carry_forward_note: '',
}

// Contains "999", traceable to nothing in Facts (a bare daily_logs row has
// zero execution quantities) — must fail containment.
const INVALID_JUDGMENT = {
  ...VALID_BLANK_JUDGMENT,
  execution_narrative: 'Completed 999 units of uncontained work today.',
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

async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()
  await db.from('dprs').delete().eq('project_id', projectId)
  await db.from('daily_logs').delete().eq('project_id', projectId)
  await db.from('projects').delete().eq('id', projectId)
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('handleDprGenerateJob', () => {
  it('SUCCESS — writes structured/content, generation_status ends idle, delivery_status untouched (stays default pending)', async () => {
    const db = testClient()
    const projectId = await makeProject('success')
    try {
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      await handleDprGenerateJob(
        { project_id: projectId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClient(VALID_BLANK_JUDGMENT) },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status, content, structured, generator_job_id')
        .eq('project_id', projectId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle')
      expect(dpr?.delivery_status).toBe('pending') // untouched — this handler never sets it on success
      expect(dpr?.content).toContain('No work was reported today.')
      expect(dpr?.structured).toBeTruthy()
      expect(dpr?.generator_job_id).toBe(FAKE_JOB_ID)
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('VALIDATION FAILURE — DprValidationError propagates, generation_status reverts to idle (never sticks at running), no content written', async () => {
    const db = testClient()
    const projectId = await makeProject('validation-failure')
    try {
      await db.from('daily_logs').insert({ project_id: projectId, tenant_id: TEST_TENANT_ID, engineer_id: testEngineerId(), log_date: LOG_DATE })

      await expect(
        handleDprGenerateJob(
          { project_id: projectId, log_date: LOG_DATE },
          FAKE_JOB_ID,
          { supabaseClient: db, anthropicClient: mockAnthropicClient(INVALID_JUDGMENT) },
        ),
      ).rejects.toBeInstanceOf(DprValidationError)

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, content')
        .eq('project_id', projectId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle') // reverted, not stuck at 'running'
      expect(dpr?.content).toBeNull() // never written — the failed attempt left no content
    } finally {
      await cleanupProject(projectId)
    }
  })
})

describe('markDprGenerationFailed', () => {
  it('sets delivery_status=failed and generation_status=idle — the NFR-17 exhausted-retries mapping', async () => {
    const db = testClient()
    const projectId = await makeProject('mark-failed')
    try {
      await db.from('dprs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        log_date: LOG_DATE,
        generation_status: 'running',
      })

      await markDprGenerationFailed(db, projectId, LOG_DATE)

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status')
        .eq('project_id', projectId)
        .eq('log_date', LOG_DATE)
        .single()
      expect(dpr?.delivery_status).toBe('failed')
      expect(dpr?.generation_status).toBe('idle')
    } finally {
      await cleanupProject(projectId)
    }
  })
})
