// T-CLK-1..4 (docs/plans/pr-c-plan.md rev 2, section 3g and section 8 row C1).
//
// Unit test, NO database: the Supabase client is a recording fake. It proves the capture fixtures send ONE fixed
// p_now to apply_material_inward_turn even when the real clock crosses IST midnight (18:30Z) mid-scenario.
// Origin: CI run 40217915047 attempt 1 failed at makeDoc(r11-dc3) with outcome 'idle' when the gap spanned 18:30Z
// (docs/reviews/050-closeout-record.md section 3).
//
// Only Date is faked (not timers), and the fixtures are re-imported per test (vi.resetModules) so each test sees a
// fresh noonIst() memo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Fixtures from '../helpers/capture-fixtures'

const IST_OFFSET_MS = 5.5 * 3600 * 1000
const istDate = (d: Date): string => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

type RpcParams = Record<string, unknown>

function fakeKit(calls: RpcParams[], onRpc: () => void): Fixtures.CaptureKit {
  const kit = {
    svc: {
      from: () => ({ insert: async () => ({ error: null }) }),
      rpc: async (_name: string, params: RpcParams) => {
        calls.push(params)
        onRpc()
        return {
          data: { outcome: 'advance', current_flow: 'invoice', current_step: 3, document_id: 'doc-1', delivery_id: 'del-1' },
          error: null,
        }
      },
    },
    tenantA: 'tenant-a',
    p1: 'project-1',
    uid: () => 'user-1',
    sid: (s: string) => `sid-${s}`,
    phone: (s: string) => `phone-${s}`,
  }
  return kit as unknown as Fixtures.CaptureKit
}

async function loadFixtures(): Promise<typeof Fixtures> {
  vi.resetModules()
  return import('../helpers/capture-fixtures')
}

describe('capture fixtures: fixed noon p_now (T-CLK)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('T-CLK-1 makeDoc with no now: every RPC carries the same p_now on one IST date, across 18:30Z', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:29:58Z'))
    const { makeDoc } = await loadFixtures()
    const calls: RpcParams[] = []
    let first = true
    const kit = fakeKit(calls, () => {
      if (first) {
        first = false
        vi.setSystemTime(new Date('2026-10-25T18:30:02Z')) // IST midnight passes between the calls
      }
    })
    await makeDoc(kit, 'dc', 'clk1')
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(c.p_now, 'every call carries p_now').toBeTypeOf('string')
    const values = calls.map((c) => c.p_now as string)
    expect(new Set(values).size).toBe(1)
    expect(new Set(values.map((v) => istDate(new Date(v)))).size).toBe(1)
  })

  it('T-CLK-2 noonIst() returns the identical instant before and after 18:30Z', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:29:58Z'))
    const { noonIst } = await loadFixtures()
    const before = noonIst()
    vi.setSystemTime(new Date('2026-10-25T18:30:02Z'))
    const after = noonIst()
    expect(after.getTime()).toBe(before.getTime())
  })

  it('T-CLK-3 an explicit now is sent unchanged as p_now (the override still wins)', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:29:58Z'))
    const { miTurn } = await loadFixtures()
    const calls: RpcParams[] = []
    const kit = fakeKit(calls, () => undefined)
    const explicit = new Date('2026-01-02T03:04:05.000Z')
    await miTurn(kit, 'phone-x', '1', 'sid-x', { now: explicit })
    expect(calls).toHaveLength(1)
    expect(calls[0].p_now).toBe('2026-01-02T03:04:05.000Z')
  })

  it('T-CLK-4 istToday() is the IST date of the memoised noonIst(), checked at 18:30:02Z', async () => {
    vi.setSystemTime(new Date('2026-10-25T18:29:58Z'))
    const { noonIst, istToday } = await loadFixtures()
    const fixedDate = istDate(noonIst()) // first call: memoised here
    expect(fixedDate).toBe('2026-10-25')
    vi.setSystemTime(new Date('2026-10-25T18:30:02Z'))
    expect(istToday()).toBe(fixedDate)
  })
})
