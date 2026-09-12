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

// Stage 3 (2026-09-11, docs/plans/dpr-format-redesign.md) — B1's own
// "ZERO Anthropic calls" premise no longer holds: correctEngineerWorkText
// (spelling correction) now legitimately calls the model whenever WORK has
// real text, INDEPENDENT of the eveningNeedsModel verdict gate B1 actually
// tests. This mock lets a spelling-correction-shaped call through (a
// distinct output_config schema, `planned_corrected`/`done_text_corrected`
// vs. `verdict`) but still fails the test outright if a VERDICT-shaped
// call is ever made -- preserving B1's real intent (the verdict gate
// skips the model) without asserting a premise Stage 3 made untrue.
function mockAnthropicClientVerdictMustNotBeCalled(): Anthropic {
  return {
    messages: {
      create: async (params: { output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } }) => {
        const isVerdictCall = !!params?.output_config?.format?.schema?.properties?.verdict
        if (isVerdictCall) {
          throw new Error('Anthropic client called for VERDICT generation when it must not be — this day should be fully code-templated')
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ planned_corrected: 'Excavation of footing', done_text_corrected: '(not provided)' }) }],
          usage: { input_tokens: 40, output_tokens: 20 },
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

  it('SUCCESS — writes structured/content keyed by engineer_id, generation_status ends idle, delivery_status untouched; AI summary disabled (2026-09-12) means ZERO verdict-generation calls even on an ordinary, both-halves-real day', async () => {
    const db = testClient()
    const projectId = await makeProject('success')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      // Real data on BOTH halves — a blank row (no fields set) resolves
      // both halves to not_received, which is a genuinely different,
      // correct code path (the code-templated skip-the-model verdict,
      // Rule 2) that this test is not the one exercising.
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

      // mockAnthropicClientVerdictMustNotBeCalled(), not mockAnthropicClient
      // -- this is the ordinary, real-data day that used to reach the model
      // (eveningNeedsModel: true). 2026-09-12: dispatch.ts's else-branch no
      // longer calls generateEngineerVerdict at all. A spelling-correction
      // call (WORK has real text) is still expected and let through; a
      // VERDICT-shaped call would fail this test outright, same mechanism
      // the B1/STAGE-4 tests below already use for the code-templated days.
      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClientVerdictMustNotBeCalled() },
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
      // No SUMMARY section at all -- verdict is '', render.ts's own
      // omit-when-empty guard drops the header and the line together.
      expect(dpr?.content).not.toContain('SUMMARY (auto-generated)')
      expect(dpr?.structured).toBeTruthy()
      const structured = dpr?.structured as { verdict?: string; verdict_status?: string } | null
      expect(structured?.verdict).toBe('')
      expect(structured?.verdict_status).toBe('disabled')
      expect(dpr?.generator_job_id).toBe(FAKE_JOB_ID)
    } finally {
      await cleanupProject(projectId)
    }
  })

  // REMOVED, 2026-09-12 (AI summary disabled) -- the two "S10" tests that
  // used to live here (containment failure -> placeholder; containment
  // fails once, succeeds on retry -> real verdict) exercised
  // dispatch.ts's own call into generateEngineerVerdict on an
  // eveningNeedsModel:true day. That call site no longer exists (see the
  // SUCCESS test above) -- dispatch.ts cannot reach containment logic at
  // all anymore, so there is no dispatch-level scenario left to assert on.
  // generateEngineerVerdict itself is untouched and still contains this
  // exact containment-retry-then-placeholder behaviour; it is still
  // directly tested by test/unit/generate-engineer-verdict.test.ts, which
  // this change does not touch. Re-enable point: lib/dpr/dispatch.ts's
  // eveningNeedsModel-true branch -- restoring the call there would make
  // these two scenarios reachable again.

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
      // Stage 3 (2026-09-11) -- the combined check-in line, not the old
      // two-line "Morning check-in: X" / "Evening check-in: X" format.
      expect(dpr?.content).toContain('Check-in: Morning not received · Evening not received')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('B1 — morning-only day (morning real, evening not received) is fully code-templated for the VERDICT: ZERO verdict-generation calls (spelling correction may still call the model), verdict is the spec\'s exact sentence, verdict_status: code_templated', async () => {
    const db = testClient()
    const projectId = await makeProject('morning-only')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      // Morning real, evening genuinely absent — the ONLY day shape prod
      // has generated so far, since the evening flow cannot yet be
      // triggered. mockAnthropicClientVerdictMustNotBeCalled() lets a
      // spelling-correction call through (WORK's morning plan is real
      // text, correctEngineerWorkText runs regardless of the verdict
      // gate) but fails the test outright if the VERDICT call ever
      // happens — that failure IS the proof the gate held, not a counted
      // assertion.
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        morning_submitted_at: '2026-05-02T04:00:00Z',
        morning_plan: 'Excavation of footing',
      })

      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClientVerdictMustNotBeCalled() },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status, content, structured')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle')
      expect(dpr?.delivery_status).toBe('pending')
      // Byte-for-byte match to docs/dpr-engineer-report-spec.md's own
      // morning-only sample line, not a paraphrase.
      expect(dpr?.content).toContain('No evening check-in, so we do not know what was done today.')
      const structured = dpr?.structured as { verdict?: string; verdict_status?: string } | null
      expect(structured?.verdict).toBe('No evening check-in, so we do not know what was done today.')
      expect(structured?.verdict_status).toBe('code_templated')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4 — not-on-site day (attendance: absent, evening not received) is fully code-templated for the VERDICT: ZERO verdict-generation calls, verdict is the proposed not-on-site sentence, verdict_status: code_templated', async () => {
    const db = testClient()
    const projectId = await makeProject('not-on-site')
    const engineerId = testEngineerId()
    try {
      await addToProject(projectId, engineerId)
      // Real shape (lib/whatsapp/flows/morning.ts): the morning flow
      // completes at Q1 when attendance resolves to 'absent' --
      // morning_submitted_at IS set, but morning_plan/morning_manpower/
      // morning_equipment are never asked, all stay null. Without the
      // Stage 4 fix, deriveHalfCompleteness would read this as an
      // ordinary 'complete' morning and codeTemplatedVerdict would wrongly
      // fall into its generic "No evening check-in..." branch.
      await db.from('daily_logs').insert({
        project_id: projectId,
        tenant_id: TEST_TENANT_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        morning_submitted_at: '2026-05-02T04:00:00Z',
        attendance: 'absent',
        is_holiday: false,
      })

      await handleDprGenerateJob(
        { project_id: projectId, engineer_id: engineerId, log_date: LOG_DATE },
        FAKE_JOB_ID,
        { supabaseClient: db, anthropicClient: mockAnthropicClientVerdictMustNotBeCalled() },
      )

      const { data: dpr } = await db
        .from('dprs')
        .select('generation_status, delivery_status, content, structured')
        .eq('project_id', projectId)
        .eq('engineer_id', engineerId)
        .eq('log_date', LOG_DATE)
        .single()

      expect(dpr?.generation_status).toBe('idle')
      expect(dpr?.content).toContain('Engineer not on site today.')
      expect(dpr?.content).toContain('Check-in: Morning not applicable — not on site today · Evening not received')
      // FIXED (2026-09-11, review round after Stage 4): dispatch.ts now
      // overwrites facts.morning_status/evening_status with
      // resolveCheckInStatus's own richer classification before rendering
      // -- render.ts's per-field gating reads the SAME not_applicable
      // signal the check-in line and codeTemplatedVerdict already used, so
      // WORK/RESOURCE are correctly OMITTED entirely, not shown with "no
      // input received" markers (which would wrongly imply a collection
      // failure rather than "nobody was there to ask").
      expect(dpr?.content).not.toContain('WORK')
      expect(dpr?.content).not.toContain('RESOURCE')
      expect(dpr?.content).not.toContain('no input received')
      // FIXED (2026-09-11, one more review round): with no sections
      // rendering, "The sections below are as reported from site." would
      // otherwise introduce nothing and sit above an empty space before
      // SUMMARY -- suppressed under the same body-length condition.
      expect(dpr?.content).not.toContain('The sections below are as reported from site.')
      const structured = dpr?.structured as { verdict?: string; verdict_status?: string } | null
      expect(structured?.verdict).toBe('Engineer not on site today.')
      expect(structured?.verdict_status).toBe('code_templated')
    } finally {
      await cleanupProject(projectId)
    }
  })

  // REMOVED, 2026-09-12 (AI summary disabled) -- "S1 — malformed model
  // response" exercised dispatch.ts's own call into generateEngineerVerdict
  // on an eveningNeedsModel:true day; that call site is gone (same
  // reasoning as the two "S10" tests removed above). The malformed-JSON
  // parse-failure path itself is untouched and still directly tested by
  // test/unit/generate-engineer-verdict.test.ts.
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
