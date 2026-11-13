// 052 block 2b, step 5: the session-leak regression (docs/reviews/052-test-db-apply-record.md, "Findings for block 2").
//
// WHAT LEAKED: two earlier capture-ingest runs left 50 whatsapp_sessions rows with current_flow = 'invoice' on test-db, and
// those rows make migration 052's A0 abort. teardownCaptureKit deleted sessions only AFTER quoco_test_capture_cleanup, which
// throws on error, so a run whose teardown stopped at that RPC (or earlier) never reached the session delete.
//
// THE TEST: create a real engineer session (a turn through the real RPC leaves the session in the 'invoice' flow), then run
// the teardown with the cleanup RPC forced to fail (a simulated aborted run), and count the run's invoice-flow sessions:
// before the fix leaked > 0, after it leaked = 0. A normal teardown follows in afterAll, so this file leaves nothing behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCaptureKit, miTurn, teardownCaptureKit, type CaptureKit } from './helpers/capture-fixtures'

let kit: CaptureKit

async function invoiceSessions(): Promise<number> {
  const { count, error } = await kit.svc
    .from('whatsapp_sessions')
    .select('phone_number', { count: 'exact', head: true })
    .in('tenant_id', [kit.tenantA, kit.tenantB])
    .eq('current_flow', 'invoice')
  if (error) throw new Error(`count failed: ${error.message}`)
  return count ?? 0
}

/** A kit whose service client fails ONLY the cleanup RPC: the shape of a run that aborts inside the teardown. */
function kitWithFailingCleanup(real: CaptureKit): CaptureKit {
  const svc = new Proxy(real.svc, {
    get(target, prop) {
      if (prop === 'rpc') {
        return (fn: string, ...rest: unknown[]) =>
          fn === 'quoco_test_capture_cleanup'
            ? Promise.resolve({ data: null, error: { message: 'simulated abort in the cleanup RPC', code: 'XX000' } })
            : (target.rpc as (f: string, ...a: unknown[]) => unknown)(fn, ...rest)
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as SupabaseClient
  return { ...real, svc }
}

beforeAll(async () => {
  kit = await buildCaptureKit('teardown-leak', ['eng', 'pm1'])
})

afterAll(async () => {
  if (!kit) return
  // The fixed teardown runs every step even when the cleanup RPC fails, so with no documents in this file it may already
  // have removed the whole kit; the real teardown then has nothing to do (the helper refuses a tenant that is gone).
  const { data } = await kit.svc.from('tenants').select('id').eq('id', kit.tenantA).maybeSingle()
  if (data) await teardownCaptureKit(kit)
})

describe('T-LEAK teardown removes sessions even when the cleanup RPC throws', () => {
  it('T-LEAK-1 an engineer turn leaves an invoice-flow session; the teardown with a failing cleanup RPC throws AND leaks none', async () => {
    const phone = kit.phone('leak')
    await miTurn(kit, phone, '4', kit.sid('leak-s0'), { start: true })
    const before = await invoiceSessions()
    // control: the premise is real (a session exists in the invoice flow before the teardown)
    expect(before).toBeGreaterThan(0)

    await expect(teardownCaptureKit(kitWithFailingCleanup(kit))).rejects.toThrow(/quoco_test_capture_cleanup/)

    const after = await invoiceSessions()
    console.info(`T-LEAK-1 invoice-flow sessions for this run's tenants: before teardown=${before} after the aborted teardown=${after} (leaked=${after})`)
    expect(after).toBe(0)
  })
})
