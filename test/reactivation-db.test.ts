import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clearMessagingBlock } from '@/lib/whatsapp/reactivation'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  testEngineerId,
  TEST_TENANT_ID,
} from './helpers/db'

// Direct DB test for the BOT-27 clear-half IO (clearMessagingBlock). Uses the
// morning engineer fixture (ENG-01 shape). Service-role client — this exercises
// the exact UPDATE the webhook issues, incl. its tenant-scoping.

describe('clearMessagingBlock (BOT-27 clear-half)', () => {
  beforeAll(async () => {
    await ensureMorningFixtures()
  })

  afterAll(async () => {
    // Leave the fixture flag false regardless of test outcome, then tear down.
    const db = testClient()
    await db.from('users').update({ messaging_blocked: false }).eq('id', testEngineerId())
    await removeMorningFixtures()
  })

  async function readBlocked(): Promise<boolean> {
    const db = testClient()
    const { data, error } = await db
      .from('users')
      .select('messaging_blocked')
      .eq('id', testEngineerId())
      .single<{ messaging_blocked: boolean }>()
    if (error) throw new Error(`readBlocked failed: ${error.message}`)
    return data.messaging_blocked
  }

  async function setBlocked(value: boolean): Promise<void> {
    const db = testClient()
    const { error } = await db
      .from('users')
      .update({ messaging_blocked: value })
      .eq('id', testEngineerId())
    if (error) throw new Error(`setBlocked failed: ${error.message}`)
  }

  async function setStatus(status: string): Promise<void> {
    const db = testClient()
    const { error } = await db.from('users').update({ status }).eq('id', testEngineerId())
    if (error) throw new Error(`setStatus failed: ${error.message}`)
  }

  it('clears messaging_blocked for the matching active engineer (cleared=true)', async () => {
    await setBlocked(true)
    expect(await readBlocked()).toBe(true)

    const { error, cleared } = await clearMessagingBlock(testClient(), testEngineerId(), TEST_TENANT_ID)
    expect(error).toBeNull()
    expect(cleared).toBe(true)
    expect(await readBlocked()).toBe(false)
  })

  it('is tenant-scoped: a wrong tenant_id does NOT clear (cleared=false)', async () => {
    await setBlocked(true)
    expect(await readBlocked()).toBe(true)

    // Well-formed but non-matching tenant — the UPDATE matches zero rows.
    const wrongTenant = '00000000-0000-4000-a000-0000000000ff'
    const { error, cleared } = await clearMessagingBlock(testClient(), testEngineerId(), wrongTenant)
    expect(error).toBeNull()
    expect(cleared).toBe(false)
    expect(await readBlocked()).toBe(true)
  })

  it('TOCTOU guard: a non-active (deactivated) engineer is NOT cleared (cleared=false)', async () => {
    // Simulates a PM deactivating the engineer between the gate read and the
    // write. The status='active' predicate in the UPDATE must reject it.
    await setBlocked(true)
    await setStatus('deactivated')
    try {
      const { error, cleared } = await clearMessagingBlock(testClient(), testEngineerId(), TEST_TENANT_ID)
      expect(error).toBeNull()
      expect(cleared).toBe(false)
      expect(await readBlocked()).toBe(true) // still blocked — not lifted
    } finally {
      await setStatus('active') // restore for other tests / teardown
    }
  })
})
