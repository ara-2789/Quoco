import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { generateEngineerVerdict } from '@/lib/dpr/generate'
import type { EngineerDprFacts } from '@/lib/dpr/schema'

// Stage 4 review round (2026-09-11, docs/plans/dpr-format-redesign.md §9).
// Pure/mocked coverage for generateEngineerVerdict's new judgment-language
// denylist path -- the RETRY loop, the shared retry budget across
// containment AND the denylist, and the "last attempt's own failure reason
// wins" rule that decides whether the caller falls back to the generic
// placeholder or to codeTemplatedVerdict's line. No DB, no real API call.

const notCaptured = { status: 'not_captured' as const, value: null }

function baseFacts(): EngineerDprFacts {
  return {
    morning_status: { status: 'complete' },
    evening_status: { status: 'complete' },
    work: {
      planned: notCaptured,
      done_text: notCaptured,
      done_quantity: { status: 'not_captured', value: null },
      unit: '',
      planned_corrected: notCaptured,
      done_text_corrected: notCaptured,
    },
    tomorrowNeeds: { note: notCaptured },
    manpower: { planned: notCaptured, on_site: notCaptured },
    idle_hours_by_trade: [{ trade: 'mason', idle_hours: 2 }],
    equipment: { items: [], machines_reported: notCaptured, run_hours: notCaptured },
    hindrances: [],
  }
}

const META = { project_name: 'Speed Mechatronics', log_date: '2026-09-05' }

// A plain string entry is verdict TEXT, JSON-wrapped as {verdict: ...} --
// a real, parseable response. { raw: '...' } sends that exact string as
// the response body, UNWRAPPED -- for simulating a genuinely malformed/
// unparseable response (JSON.stringify({verdict: '{not valid json'})
// would otherwise still be perfectly valid JSON, defeating the point).
function mockAnthropicClientSequence(responses: Array<string | { raw: string }>): Anthropic & { callCount: number } {
  let callCount = 0
  return {
    messages: {
      create: async () => {
        const entry = responses[Math.min(callCount, responses.length - 1)]
        callCount++
        const text = typeof entry === 'string' ? JSON.stringify({ verdict: entry }) : entry.raw
        return {
          content: [{ type: 'text', text }],
          usage: { input_tokens: 40, output_tokens: 20 },
          stop_reason: 'end_turn',
        }
      },
    },
    get callCount() {
      return callCount
    },
  } as unknown as Anthropic & { callCount: number }
}

describe('generateEngineerVerdict — judgment-language denylist', () => {
  it('a clean verdict (no denylist hit) passes on attempt 1: verdict_status model, one call', async () => {
    const client = mockAnthropicClientSequence(['2 masons idle 2 hours.'])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('model')
    expect(result.verdict).toBe('2 masons idle 2 hours.')
    expect(result.attempts).toBe(1)
  })

  it('denylist hit on attempt 1, clean on the retry: verdict_status model, uses the RETRY text, 2 attempts', async () => {
    const client = mockAnthropicClientSequence(['Productivity was poor today.', '2 masons idle 2 hours.'])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('model')
    expect(result.verdict).toBe('2 masons idle 2 hours.')
    expect(result.attempts).toBe(2)
  })

  it('denylist hit on BOTH attempts: verdict_status judgment_denylist, empty verdict, 2 attempts', async () => {
    const client = mockAnthropicClientSequence(['Productivity was poor today.', 'A disappointing outcome.'])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('judgment_denylist')
    expect(result.verdict).toBe('')
    expect(result.attempts).toBe(2)
  })

  it('containment fails on attempt 1, denylist fails on attempt 2 (the RETRY): final status is judgment_denylist -- the LAST attempt\'s own failure reason decides', async () => {
    // containment failure: a digit not traceable to any Fact (idle_hours=2 is the only citable digit here).
    const client = mockAnthropicClientSequence(['Delivered 999 bags today.', 'A bad day overall.'])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('judgment_denylist')
  })

  it('denylist fails on attempt 1, containment fails on attempt 2 (the RETRY): final status is placeholder -- NOT judgment_denylist, since the last attempt failed on containment', async () => {
    const client = mockAnthropicClientSequence(['A bad day overall.', 'Delivered 999 bags today.'])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('placeholder')
  })

  it('a malformed response on the final attempt (after a denylist hit on attempt 1) falls back to placeholder, not judgment_denylist', async () => {
    const client = mockAnthropicClientSequence(['A bad day overall.', { raw: '{not valid json' }])
    const result = await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(result.verdict_status).toBe('placeholder')
  })

  it('only ONE retry total -- exactly 2 calls made, never more, on a sustained denylist hit', async () => {
    const client = mockAnthropicClientSequence(['Poor productivity.', 'Still poor productivity.'])
    await generateEngineerVerdict(client, baseFacts(), null, META)
    expect(client.callCount).toBe(2)
  })
})
