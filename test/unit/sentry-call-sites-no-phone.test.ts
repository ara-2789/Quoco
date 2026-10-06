import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// P0 (Sentry PII): two call sites used to send the engineer's phone number
// as `extra.phoneNumber`:
//   - lib/whatsapp/inbound-start.ts   handleIdlePhoto's claimMediaNudge catch
//   - lib/whatsapp/flows/hindrance.ts applyHindranceFlowTurn's
//     completion-with-no-hindrance_id branch
// Each test drives the real failure path with Sentry mocked, serialises EVERY
// argument of the Sentry call, and asserts no test phone number appears.
//
// SCOPE NOTE: the thrown-error messages that embed a phone number
// (session.ts, flows/*.ts, inbound-start.ts) are NOT changed in this PR and
// are not asserted here; the scrubber covers them in Sentry. The rejected
// error below deliberately carries no number, to isolate `extra`.
const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn((_m: string, _o?: Record<string, unknown>) => 'mock-event-id'),
  captureException: vi.fn((_e: unknown, _o?: Record<string, unknown>) => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

vi.mock('@/lib/whatsapp/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/whatsapp/session')>()
  return {
    ...original,
    readActiveFlowForRouting: vi.fn(async () => null),
    claimMediaNudge: vi.fn(async () => {
      throw new Error('claim_media_nudge rpc unavailable')
    }),
  }
})

const RUN_TAG = crypto.randomUUID()
const PHONE_DIGITS = `9${RUN_TAG.replace(/\D/g, '').padEnd(9, '7').slice(0, 9)}`
const PHONE = `+91${PHONE_DIGITS}`
const TENANT_ID = crypto.randomUUID()
const PROJECT_ID = crypto.randomUUID()
const USER_ID = crypto.randomUUID()

/** JSON.stringify drops Error fields; spell them out so a message can't hide. */
function serialise(calls: unknown[][]): string {
  return JSON.stringify(calls, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  )
}

/** A chainable stand-in for the daily_logs lookup: no row, no error. */
function fakeSupabaseNoDailyLog(): SupabaseClient {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  return chain as unknown as SupabaseClient
}

beforeEach(() => {
  captureMessage.mockClear()
  captureException.mockClear()
})

describe('inbound-start handleIdlePhoto: claimMediaNudge throws', () => {
  it('reports to Sentry without the phone number, keeps the internal ids, and still fails open', async () => {
    const { routeInboundMessage } = await import('@/lib/whatsapp/inbound-start')
    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: '',
      isPhoto: true,
      supabaseClient: fakeSupabaseNoDailyLog(),
    })

    expect(result.reply).not.toBe('') // fail-open behaviour unchanged
    expect(captureException).toHaveBeenCalledTimes(1)
    const [, options] = captureException.mock.calls[0] as [unknown, { extra: Record<string, unknown> }]
    expect(options.extra).toEqual({ tenantId: TENANT_ID, projectId: PROJECT_ID })

    const serialised = serialise(captureException.mock.calls)
    expect(serialised).not.toContain(PHONE_DIGITS)
    expect(serialised).toContain(TENANT_ID)
  })
})

describe('hindrance flow: genuine completion with no hindrance_id', () => {
  it('reports to Sentry without the phone number, keeps the internal ids', async () => {
    const { applyHindranceFlowTurn } = await import('@/lib/whatsapp/flows/hindrance')
    const fakeRpcClient = {
      rpc: async () => ({
        data: {
          outcome: 'advance',
          current_flow: null,
          current_step: 0,
          hindrance_id: null,
          was_unspecified: false,
        },
        error: null,
      }),
    } as unknown as SupabaseClient

    await applyHindranceFlowTurn({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: `done ${RUN_TAG}`,
      startFlow: false,
      supabaseClient: fakeRpcClient,
    })

    expect(captureException).toHaveBeenCalledTimes(1)
    const [, options] = captureException.mock.calls[0] as [unknown, { extra: Record<string, unknown> }]
    expect(options.extra).toEqual({ projectId: PROJECT_ID, userId: USER_ID })

    const serialised = serialise(captureException.mock.calls)
    expect(serialised).not.toContain(PHONE_DIGITS)
    expect(serialised).toContain(PROJECT_ID)
  })
})
