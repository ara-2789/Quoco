import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_PROJECT_A_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
} from './helpers/db'

// Migration 020 — function EXECUTE hardening. ACL negative-control suite
// (015/017 model), keyed on SQLSTATE. The PROVE-OPEN leg is running this BEFORE
// 020 is applied: the anon/authenticated calls then pass the ACL and fail deeper
// in the body (or succeed) — NOT 42501 — which demonstrates the door is currently
// open. After apply, the same calls fail at 42501 (ACL rejection, before the body).
//
//   T-020-01..03  anon → the 3 parameter-trusting fns → 42501
//   T-020-04      authenticated → the same 3 → 42501 (server-only now)
//   T-020-05      CANARY: service_role still gets PAST the ACL (not 42501)
//   T-020-06      anon → complete_onboarding → 42501 (Class 2)
//   T-020-07      LANDMINE 1: an authenticated tenant-scoped read STILL works
//                 (RLS calls get_user_tenant_id as the querying role)
//   T-020-08      LANDMINE 1: anon get_user_tenant_id → 42501; authenticated → not
//   T-020-09      LANDMINE 2: handle_new_user still fires from the auth trigger
//                 (creating an auth user still materialises its public.users stub)
//
// NOTE (landmine 2): T-020-09 proves the trigger path works post-revoke, but the
// reviewer ALSO requires a REAL magic-link signup end-to-end during rehearsal —
// that exercises the full Supabase-Auth → supabase_auth_admin → trigger chain and
// cannot be fully reproduced from a test. Do that manually.

const DUMMY_UUID = '00000000-0000-4000-a000-0000000200ff'
const DUMMY_PHONE = '+19995550209' // fictional NANP test space (never a real number)

// Payloads carry only the REQUIRED (no-default) params so PostgREST resolves each
// overload; ACL rejection precedes the body, so the values are inert.
const APPLY_ARGS = {
  p_phone_number: DUMMY_PHONE, p_tenant_id: DUMMY_UUID, p_user_id: DUMMY_UUID,
  p_project_id: DUMMY_UUID, p_message: 'x', p_start_flow: false,
}
const ACQUIRE_ARGS = {
  p_phone_number: DUMMY_PHONE, p_tenant_id: DUMMY_UUID, p_user_id: DUMMY_UUID,
  p_requested_flow: null, p_caller: 'webhook',
}
const DRAIN_ARGS = { p_phone_number: DUMMY_PHONE }
const ONBOARD_ARGS = { p_company_name: 'zz-020', p_slug: 'zz-020-acl', p_full_name: 'zz' }

function anonClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

let fx: TwoTenantFixtures
let jwtA: SupabaseClient
const anon = anonClient()

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()
  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterAll(async () => {
  await removeTwoTenantFixtures()
})

describe('migration 020 — function EXECUTE hardening', () => {
  it('T-020-01: anon → apply_morning_flow_turn is denied at the ACL (42501)', async () => {
    const { error } = await anon.rpc('apply_morning_flow_turn', APPLY_ARGS)
    expect(error?.code).toBe('42501')
  })

  it('T-020-02: anon → acquire_and_transition_session is denied (42501)', async () => {
    const { error } = await anon.rpc('acquire_and_transition_session', ACQUIRE_ARGS)
    expect(error?.code).toBe('42501')
  })

  it('T-020-03: anon → drain_next_pending_flow is denied (42501)', async () => {
    const { error } = await anon.rpc('drain_next_pending_flow', DRAIN_ARGS)
    expect(error?.code).toBe('42501')
  })

  it('T-020-04: authenticated → all three parameter-trusting fns are denied (server-only)', async () => {
    for (const [fn, args] of [
      ['apply_morning_flow_turn', APPLY_ARGS],
      ['acquire_and_transition_session', ACQUIRE_ARGS],
      ['drain_next_pending_flow', DRAIN_ARGS],
    ] as const) {
      const { error } = await jwtA.rpc(fn, args)
      expect(error?.code, `${fn} should be 42501 for authenticated`).toBe('42501')
    }
  })

  it('T-020-05: CANARY — service_role still passes the ACL (fails deeper, not 42501)', async () => {
    // Dummy tenant/user don't exist, so the body fails on an FK/logic error and
    // rolls back (no row created). The point is only that it is NOT 42501 —
    // proving service_role retained EXECUTE (the webhook path still works).
    const { error } = await testClient().rpc('apply_morning_flow_turn', APPLY_ARGS)
    expect(error?.code).not.toBe('42501')
  })

  it('T-020-06: anon → complete_onboarding is denied (42501)', async () => {
    const { error } = await anon.rpc('complete_onboarding', ONBOARD_ARGS)
    expect(error?.code).toBe('42501')
  })

  it('T-020-07: LANDMINE 1 — an authenticated tenant-scoped read still returns rows', async () => {
    // projects_select RLS calls get_user_tenant_id() as the querying role. If that
    // grant were stripped from authenticated, this read would 42501 instead of
    // returning the row.
    const { data, error } = await jwtA.from('projects').select('id').eq('id', TEST_PROJECT_A_ID)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: TEST_PROJECT_A_ID }])
  })

  it('T-020-08: LANDMINE 1 — anon get_user_tenant_id denied; authenticated retained', async () => {
    const anonRes = await anon.rpc('get_user_tenant_id')
    expect(anonRes.error?.code).toBe('42501')
    const authRes = await jwtA.rpc('get_user_tenant_id')
    expect(authRes.error?.code).not.toBe('42501')
  })

  it('T-020-09: LANDMINE 2 — handle_new_user still fires (auth-user insert materialises the stub)', async () => {
    const db = testClient()
    const email = 'zz-020-trigger@quoco.test'
    // clean any leftover from a prior run
    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const leftover = pre?.users.find((u) => u.email === email)
    if (leftover) {
      await db.from('users').delete().eq('auth_id', leftover.id)
      await db.auth.admin.deleteUser(leftover.id)
    }

    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email, password: 'zz-020-Trigger-Pw-4a1b', email_confirm: true,
    })
    expect(cErr).toBeNull()
    const authId = created!.user!.id
    try {
      const { data: stub, error: sErr } = await db
        .from('users').select('id').eq('auth_id', authId).maybeSingle<{ id: string }>()
      expect(sErr).toBeNull()
      expect(stub).not.toBeNull() // the trigger's handle_new_user INSERT ran
    } finally {
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
    }
  })
})
