// Shared fixture helpers for the outbound-send suite (Pass 1 items B/D/F) --
// extracted from test/outbound-trigger.test.ts (2026-08-28, item D/F build)
// so a SECOND test file (test/status-callback.test.ts) can reuse the exact
// same parent tenant/project and engineer-minting logic instead of
// re-typing it -- the same "don't duplicate real logic" reasoning that
// exported RATE_LIMITED_MARKER from trigger.ts rather than re-typing that
// literal a second place. See test/outbound-trigger.test.ts's own header
// (THE SHAPE USED HERE, SESSION SHARING, ACCRETION) for the full design
// history and reasoning behind this shape -- not repeated here.

import { testClient } from './db'

export const OUTBOUND_TEST_TENANT_ID = '00000000-0000-4000-a000-000000031000'
export const OUTBOUND_TEST_PROJECT_ID = '00000000-0000-4000-a000-000000031001'

export async function ensureOutboundParentFixtures(): Promise<void> {
  const db = testClient()
  const { error: tenantErr } = await db
    .from('tenants')
    .upsert(
      { id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Tenant (outbound-send suite)', slug: 'zz-outbound-send' },
      { onConflict: 'id' },
    )
  if (tenantErr) throw new Error(`ensureOutboundParentFixtures tenant failed: ${tenantErr.message}`)

  const { error: projErr } = await db
    .from('projects')
    .upsert(
      { id: OUTBOUND_TEST_PROJECT_ID, tenant_id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Project (outbound-send suite)' },
      { onConflict: 'id' },
    )
  if (projErr) throw new Error(`ensureOutboundParentFixtures project failed: ${projErr.message}`)
}

export interface MintedEngineer {
  id: string
  whatsappNumber: string
}

/**
 * Insert a brand-new `users` row under the shared outbound-send tenant,
 * with a randomly generated whatsapp_number -- retried on a unique-
 * constraint collision (users.whatsapp_number), so a genuine collision
 * (unlikely, not impossible) never flakes the test. The "+19995551" prefix
 * is deliberately the fake NANP test space (test/helpers/db.ts's own
 * TEST_PHONE_PREFIX, "+19995550") with its LAST prefix digit changed from 0
 * to 1 -- a disjoint range from every existing fixed testPhone('NNN') slot
 * in this repo, by construction, not by checking a list that could go
 * stale. See test/helpers/db.ts's own UNIQUENESS AXIS RULE for why callers
 * should mint ONCE per suite (in their own beforeAll), never per test.
 */
export async function mintOutboundEngineer(): Promise<MintedEngineer> {
  const db = testClient()
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0')
    const whatsappNumber = `+19995551${suffix}`
    const { data, error } = await db
      .from('users')
      .insert({
        tenant_id: OUTBOUND_TEST_TENANT_ID,
        full_name: 'ZZ Test Engineer (outbound-send suite, minted)',
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        whatsapp_number: whatsappNumber,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (!error) return { id: data.id, whatsappNumber }
    if (error.code !== '23505') throw new Error(`mintOutboundEngineer insert failed: ${error.message}`)
    // whatsapp_number collision -- retry with a fresh random suffix.
  }
  throw new Error('mintOutboundEngineer: exhausted retries minting a unique whatsapp_number')
}
