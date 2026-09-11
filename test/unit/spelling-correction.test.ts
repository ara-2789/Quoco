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
    // ceiling for a 3-char word is max(1, floor(3*0.25)) = 1 -- exceeds it.
    const result = checkSpellingGuard('did not arrive', 'did far arrive')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word changed too much')
  })

  it('allows a short word within its ceiling -- distance exactly at the boundary', () => {
    // "not" -> "nor": distance 1 (single substitution), ceiling for a
    // 3-char word is max(1, floor(3*0.25)) = 1 -- exactly at it. (Not a
    // claim this is a plausible real correction, only that the arithmetic
    // at this boundary behaves as documented.)
    expect(checkSpellingGuard('did not arrive', 'did nor arrive')).toEqual({ ok: true })
  })

  it('accepts a longer word with a typo within the tightened ceiling', () => {
    // "excavaton" (9 chars, raw) -> ceiling = min(2, max(1, floor(9*0.25))) = 2
    expect(checkSpellingGuard('Continue excavaton work', 'Continue excavation work')).toEqual({ ok: true })
  })

  it('allows a genuine transposition at the tightened ceiling boundary', () => {
    // "recieved" (8 chars) -> "received": a two-letter transposition,
    // Levenshtein distance 2. Ceiling = min(2, max(1, floor(8*0.25))) = 2
    // -- exactly at the boundary.
    expect(checkSpellingGuard('recieved the delivery', 'received the delivery')).toEqual({ ok: true })
  })

  it('REVIEW ROUND 2 PINNED CASE: "concrete" -> "complete" now FAILS the tightened guard', () => {
    // Both real words, 8 characters, 3 edits apart (positions 3-5: n/c/r
    // vs m/p/l). The OLD ceiling (40% capped at 4 -> 4 for an 8-char word)
    // let this through, silently changing what a WORK sentence about site
    // material means. Ceiling is now min(2, max(1, floor(8*0.25))) = 2;
    // distance 3 > 2 -- rejected, falls back to raw.
    const result = checkSpellingGuard('Poured the concrete slab', 'Poured the complete slab')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('word changed too much')
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

// Returns a different response on each successive call -- for testing the
// retry path, where attempt 1 and attempt 2 must produce distinguishable
// results. Also exposes callCount so a test can assert exactly how many
// calls were made (no more than the one retry, and no call at all when
// none was needed).
function mockAnthropicClientSequence(responses: Array<{ planned_corrected: string; done_text_corrected: string } | string>): Anthropic & { callCount: number } {
  let callCount = 0
  const client = {
    messages: {
      create: async () => {
        const response = responses[Math.min(callCount, responses.length - 1)]
        callCount++
        return {
          content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }],
          usage: { input_tokens: 40, output_tokens: 20 },
          stop_reason: 'end_turn',
        }
      },
    },
    get callCount() {
      return callCount
    },
  } as unknown as Anthropic & { callCount: number }
  return client
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

// ---------------------------------------------------------------------
// Retry (review round 2, Aravind): "ONE model call" meant one call
// covering both fields, not one per field -- it was never about retries.
// ONE retry on a guard failure, matching generate.ts's own verdict path.
// ---------------------------------------------------------------------

describe('correctEngineerWorkText — retry (review round 2)', () => {
  it('both fields pass the guard on attempt 1: NO second call is made', async () => {
    const client = mockAnthropicClientSequence([{ planned_corrected: 'Continue excavation work', done_text_corrected: 'Poured cement slab' }])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('corrected')
    expect(result.done_text_status).toBe('corrected')
    expect(client.callCount).toBe(1)
  })

  it('one field fails the guard on attempt 1, succeeds on the retry: ends up corrected, exactly 2 calls made', async () => {
    const client = mockAnthropicClientSequence([
      { planned_corrected: 'Continue excavation work tomorrow as well', done_text_corrected: 'Poured cement slab' }, // planned rephrased, fails
      { planned_corrected: 'Continue excavation work', done_text_corrected: 'Poured cement slab' }, // planned fixed on retry
    ])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('corrected')
    expect(result.planned).toEqual(reported('Continue excavation work'))
    expect(client.callCount).toBe(2)
  })

  it('a field still fails the guard after the retry: falls back to raw, exactly 2 calls made (not infinite)', async () => {
    const client = mockAnthropicClientSequence([
      { planned_corrected: 'Continue excavation work tomorrow as well', done_text_corrected: 'Poured cement slab' },
      { planned_corrected: 'Continue excavation work tomorrow too', done_text_corrected: 'Poured cement slab' }, // still rephrased
    ])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('fallback_raw')
    expect(result.planned).toEqual(reported('Continue excavaton work')) // raw, unmodified
    expect(client.callCount).toBe(2)
  })

  it('PER-FIELD ISOLATION ACROSS THE RETRY: a field already accepted on attempt 1 is untouched by the retry, even though the retry response differs for that field too', async () => {
    const client = mockAnthropicClientSequence([
      { planned_corrected: 'Continue excavation work', done_text_corrected: 'Poured cement slab tomorrow as well' }, // planned OK, done_text rephrased
      { planned_corrected: 'SOMETHING DIFFERENT for planned entirely', done_text_corrected: 'Poured cement slab' }, // retry: planned would ALSO now fail if re-evaluated
    ])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    // planned was locked in from attempt 1 -- must stay the attempt-1 value,
    // never re-evaluated against attempt 2's (guard-failing) text.
    expect(result.planned_status).toBe('corrected')
    expect(result.planned).toEqual(reported('Continue excavation work'))
    expect(result.done_text_status).toBe('corrected')
    expect(result.done_text).toEqual(reported('Poured cement slab'))
    expect(client.callCount).toBe(2)
  })

  it('malformed JSON on attempt 1, valid on attempt 2: both fields resolve from attempt 2, exactly 2 calls made', async () => {
    const client = mockAnthropicClientSequence(['{not valid json', { planned_corrected: 'Continue excavation work', done_text_corrected: 'Poured cement slab' }])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('corrected')
    expect(result.done_text_status).toBe('corrected')
    expect(client.callCount).toBe(2)
  })

  it('malformed JSON on BOTH attempts: both reported fields fall back to raw, exactly 2 calls made', async () => {
    const client = mockAnthropicClientSequence(['{not valid json', '{also not valid'])
    const result = await correctEngineerWorkText(client, reported('Continue excavaton work'), reported('Poured cemant slab'))
    expect(result.planned_status).toBe('fallback_raw')
    expect(result.done_text_status).toBe('fallback_raw')
    expect(client.callCount).toBe(2)
  })
})
