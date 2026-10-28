import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/nextjs'
import { scrubErrorEvent } from '@/lib/observability/scrub-pii'
import { applyMaterialInwardTurn, MaterialInwardDbError } from '@/lib/whatsapp/flows/material-inward'
import type { SupabaseClient } from '@supabase/supabase-js'

// PR-C C4a, plan item 4. Existing throw sites embed the engineer's phone ("<rpc> failed for +91XXXXXXXXXX: <msg>");
// C4a edits none of them. The Sentry scrubber (sentry.server.config.ts: beforeSend: scrubErrorEvent) is their backstop.
// This file pins that backstop for the exact shape, in BOTH the exception value and the event message, and proves the
// new C4a error text never carries a phone/id at all.

const PHONE = '+919876543210'
const identity = <T,>(x: T): T => x

function event(rpc: string): ErrorEvent {
  const text = `${rpc} failed for ${PHONE}: boom`
  return { type: undefined, message: text, exception: { values: [{ type: 'Error', value: text }] } } as unknown as ErrorEvent
}

function assertRedacted(scrub: (e: ErrorEvent) => ErrorEvent, rpc: string): void {
  const out = scrub(event(rpc))
  expect(out.exception?.values?.[0]?.value).toBe(`${rpc} failed for [redacted-phone]: boom`)
  expect(out.message).toBe(`${rpc} failed for [redacted-phone]: boom`)
  expect(JSON.stringify(out)).not.toContain('9876543210')
}

const RPCS = ['expire_stale_material_inward', 'apply_material_inward_turn', 'readRoutingState', 'claim_media_nudge']

describe('scrubErrorEvent redacts "<rpc> failed for +91XXXXXXXXXX: <msg>"', () => {
  it.each(RPCS)('%s: exception value and message', (rpc) => {
    assertRedacted(scrubErrorEvent, rpc)
  })

  it('POSITIVE CONTROL: the same assertion fails against an identity beforeSend', () => {
    for (const rpc of RPCS) {
      expect(() => assertRedacted(identity, rpc)).toThrow()
    }
  })
})

describe('C4a error text carries no phone, id or provider message', () => {
  const TENANT = crypto.randomUUID()
  const USER = crypto.randomUUID()
  const failing = (code: unknown, message: string) =>
    ({ rpc: async () => ({ data: null, error: { code, message } }) }) as unknown as SupabaseClient

  async function thrown(client: SupabaseClient): Promise<Error> {
    try {
      await applyMaterialInwardTurn({
        phoneNumber: PHONE,
        tenantId: TENANT,
        userId: USER,
        projectId: crypto.randomUUID(),
        message: 'secret body text',
        messageSid: 'SMtest',
        startFlow: false,
        supabaseClient: client,
      })
    } catch (e) {
      return e as Error
    }
    throw new Error('expected applyMaterialInwardTurn to throw')
  }

  it('applyMaterialInwardTurn names the RPC and a sanitised code only', async () => {
    const err = await thrown(failing('QE012', `E12 for ${PHONE} ${TENANT}`))
    expect(err).toBeInstanceOf(MaterialInwardDbError)
    expect(err.message).toBe('apply_material_inward_turn failed (code QE012)')
    for (const needle of [PHONE, '9876543210', TENANT, USER, 'secret body text', 'E12 for']) expect(err.message).not.toContain(needle)
  })

  it('a code that is not five upper-case letters/digits becomes "unknown"', async () => {
    expect((await thrown(failing('PGRST301', 'x'))).message).toBe('apply_material_inward_turn failed (code unknown)')
    expect((await thrown(failing(undefined, 'x'))).message).toBe('apply_material_inward_turn failed (code unknown)')
  })

  it('CONTROL: an old-style message that interpolates the phone is caught by the same needles', () => {
    const oldStyle = new Error(`apply_material_inward_turn failed for ${PHONE}: boom`)
    expect(oldStyle.message).toContain(PHONE)
  })
})
