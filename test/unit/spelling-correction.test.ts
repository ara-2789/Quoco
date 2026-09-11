import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { checkSpellingGuard, correctEngineerWorkText } from '@/lib/dpr/spelling-correction'
import type { CapturedText } from '@/lib/dpr/schema'

// Stage 2 (2026-09-11, docs/plans/dpr-format-redesign.md §1). Pure guard
// coverage plus a mocked-Anthropic-client coverage of the full function --
// no DB, no real API call, no wiring into any live path (this module is
// not called from anywhere yet, per its own header).

describe('checkSpellingGuard', () => {
  it('accepts a genuine single-word spelling fix', () => {
    expect(checkSpellingGuard('cemant lorry not arived', 'cement lorry not arrived')).toEqual({ ok: true })
  })

  it('accepts an identical string (nothing to fix)', () => {
    expect(checkSpellingGuard('Cement lorry not arrived, slab pour stopped', 'Cement lorry not arrived, slab pour stopped')).toEqual({ ok: true })
  })

  it('accepts a pure capitalisation change (free, does not count against the ceiling)', () => {
    expect(checkSpellingGuard('jcb Excavator', 'JCB excavator')).toEqual({ ok: true })
  })

  it('rejects a rephrase that adds a word -- word count changed', () => {
    const result = checkSpellingGuard('Cement lorry not arrived, slab pour stopped', 'The cement lorry has not arrived, so the slab pour stopped')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word count changed')
  })

  it('rejects a rephrase that removes a word -- word count changed', () => {
    const result = checkSpellingGuard('Continue Tower 2 slab work today', 'Continue Tower 2 slab work')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word count changed')
  })

  it('rejects any change to a digit token, even a plausible-looking one', () => {
    const result = checkSpellingGuard('Poured 120 sqm of M25 concrete', 'Poured 125 sqm of M25 concrete')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('digit token changed')
  })

  it('rejects a changed unit/digit-bearing token like "3rd" -> "3nd"', () => {
    const result = checkSpellingGuard('3rd floor slab poured', '3nd floor slab poured')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('digit token changed')
  })

  it('rejects a punctuation change even when the letters are identical', () => {
    const result = checkSpellingGuard('slab pour stopped.', 'slab pour stopped!')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('punctuation changed')
  })

  it('rejects a word swapped for a same-length but unrelated word (distance too large for the ceiling)', () => {
    // "today" (5 chars) -> "slowly" is a different word entirely, not a typo fix.
    const result = checkSpellingGuard('Continue work today', 'Continue work slowly')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word changed too much')
  })

  it('rejects a short word rewritten to a genuinely different short word', () => {
    // "not" -> "far": Levenshtein distance 3 (no shared aligned letters),
    // ceiling for a 3-char word is max(1, ceil(3*0.4)) = 2 -- exceeds it.
    const result = checkSpellingGuard('did not arrive', 'did far arrive')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word changed too much')
  })

  it('allows a short word within its ceiling -- distance exactly at the boundary', () => {
    // "not" -> "nor": distance 1 (single substitution), ceiling for a
    // 3-char word is max(1, ceil(3*0.4)) = 2 -- within it. (Not a claim
    // this is a plausible real correction, only that the arithmetic at
    // this boundary behaves as documented.)
    expect(checkSpellingGuard('did not arrive', 'did nor arrive')).toEqual({ ok: true })
  })

  it('accepts a longer word with a typo within the ceiling', () => {
    // "excavation" (10 chars) -> ceiling = min(4, max(1, ceil(10*0.4))) = 4
    expect(checkSpellingGuard('Continue excavaton work', 'Continue excavation work')).toEqual({ ok: true })
  })

  it('is not fooled by a proper-noun-length coincidence -- still enforces the ceiling on long words', () => {
    // A single character changed on a long word stays within ceiling and is allowed.
    expect(checkSpellingGuard('recieved the delivery', 'received the delivery')).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------
// correctEngineerWorkText -- mocked Anthropic client, same shape as
// test/dpr-generate-job.test.ts's own mockAnthropicClient helper.
// ---------------------------------------------------------------------

function mockAnthropicClient(response: { planned_corrected: string; done_text_corrected: string } | string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }],
        usage: { input_tokens: 40, output_tokens: 20 },
        stop_reason: 'end_turn',
      }),
    },
  } as unknown as Anthropic
}

function mockAnthropicClientThatMustNotBeCalled(): Anthropic {
  return {
    messages: {
      create: async () => {
        throw new Error('Anthropic client called when it must not be -- nothing to correct')
      },
    },
  } as unknown as Anthropic
}

const reported = (value: string): CapturedText => ({ status: 'reported', value })
const notCaptured: CapturedText = { status: 'not_captured', value: null }

describe('correctEngineerWorkText', () => {
  it('both fields not_captured: skips the model call entirely', async () => {
    const result = await correctEngineerWorkText(mockAnthropicClientThatMustNotBeCalled(), notCaptured, notCaptured)
    expect(result.model_called).toBe(false)
    expect(result.planned_status).toBe('not_attempted')
    expect(result.done_text_status).toBe('not_attempted')
    expect(result.planned).toEqual(notCaptured)
    expect(result.done_text).toEqual(notCaptured)
    expect(result.cost_usd).toBe(0)
  })

  it('both fields reported, both corrections pass the guard: both corrected', async () => {
    const client = mockAnthropicClient({ planned_corrected: 'Continue excavation work', done_text_corrected: 'Poured cement slab' })
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.model_called).toBe(true)
    expect(result.planned_status).toBe('corrected')
    expect(result.planned).toEqual(reported('Continue excavation work'))
    expect(result.done_text_status).toBe('corrected')
    expect(result.done_text).toEqual(reported('Poured cement slab'))
  })

  it('per-field isolation: one field fails the guard (rephrase), the other still corrects', async () => {
    const client = mockAnthropicClient({
      planned_corrected: 'Continue excavation work tomorrow as well', // rephrased -- extra words, fails guard
      done_text_corrected: 'Poured cement slab', // genuine fix -- passes guard
    })
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('fallback_raw')
    expect(result.planned).toEqual(reported('Continue excavaton work')) // raw, unmodified
    expect(result.done_text_status).toBe('corrected')
    expect(result.done_text).toEqual(reported('Poured cement slab'))
  })

  it('one field not reported, the other reported: only the reported one is sent/corrected, the other stays not_attempted regardless of model output', async () => {
    const client = mockAnthropicClient({ planned_corrected: 'Continue excavation work', done_text_corrected: '(not provided)' })
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), notCaptured)
    expect(result.planned_status).toBe('corrected')
    expect(result.done_text_status).toBe('not_attempted')
    expect(result.done_text).toEqual(notCaptured)
  })

  it('malformed JSON response: both reported fields fall back to raw, model_called is still true', async () => {
    const client = mockAnthropicClient('{not valid json')
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.model_called).toBe(true)
    expect(result.planned_status).toBe('fallback_raw')
    expect(result.planned).toEqual(reported('Continue excavaton work'))
    expect(result.done_text_status).toBe('fallback_raw')
    expect(result.done_text).toEqual(reported('Poured cemant slab'))
  })

  it('a field never reported stays not_attempted even after a malformed response, not fallback_raw', async () => {
    const client = mockAnthropicClient('{not valid json')
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), notCaptured)
    expect(result.planned_status).toBe('fallback_raw')
    expect(result.done_text_status).toBe('not_attempted')
    expect(result.done_text).toEqual(notCaptured)
  })

  it('cost/usage are reported when the model is called', async () => {
    const client = mockAnthropicClient({ planned_corrected: 'Continue excavation work', done_text_corrected: '(not provided)' })
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), notCaptured)
    expect(result.usage).toEqual({ input_tokens: 40, output_tokens: 20 })
    expect(result.cost_usd).toBeGreaterThan(0)
  })
})
