// Add-engineer slice 1, PR A (A3). Real test-db (exfccwlrhoutkgrlikod, guarded
// by test/setup/guard.ts) for the app path; a fake client for the SQLSTATE
// mapping. Covers:
//   - the RPC wrapper's SQLSTATE -> outcome mapping (plan section 5),
//   - preview: TS rejections never reach the RPC, dry-run writes nothing (T7),
//   - T46(ii): a swap that preserves the count is refused BEFORE any RPC call,
//   - T13 + T46(iii): the ONE boundary literal, applied end to end, read back,
//     on a neutralised (non-active) project,
//   - T14 (partial, see the note at that test): the engineer resolves to project A.
//
// CONCURRENCY (T15 / R8 race): CI-only, NOT verified locally. Nothing in this
// file exercises two callers at once; the 'apply lost the race' outcome is
// tested only by making the second apply deterministically non-ok.
//
// T21 (see test/engineer-boundary-literal-guard.test.ts): this file imports
// test/helpers/db.ts, imports NOTHING under lib/whatsapp/outbound/ or
// app/api/cron/, and neutralises project A with an explicit status of
// 'on_hold' (never NULL: `NULL <> 'active'` is NULL, decision D-A8) so no cron
// roster can ever load the boundary engineer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TEST_007_PASSWORD,
  TEST_007_USER_A_EMAIL,
  TEST_PROJECT_A_ID,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  ensureTwoTenantFixtures,
  jwtClient,
  removeTwoTenantFixtures,
  testClient,
  type TwoTenantFixtures,
} from './helpers/db'
import { resolveEngineerProject } from '@/lib/whatsapp/project-resolution'
import {
  addEngineersToProject,
  applyEngineers,
  previewEngineers,
  submitApply,
} from '@/lib/engineers/add-engineers'
import { TEST_BOUNDARY_PHONE_LITERAL as N, boundaryDerivedNumber } from './helpers/boundary-phone'

// The two-tenant fixture setup and teardown are dozens of sequential round
// trips; with test-db under load they exceed the 30 s default (observed
// 2026-09-21 in test/engineer-tenant-isolation.test.ts: both hooks timed out
// and the teardown was cut off before its last step).
const HOOK_TIMEOUT_MS = 180_000

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

// Wrap a real client so every rpc() call is recorded (the spy T46(ii) needs).
function spyOn(client: SupabaseClient): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = []
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        return (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args })
          return target.rpc(fn, args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { client: proxy, calls }
}

// A client whose rpc() returns a canned PostgREST-shaped response.
function fakeClient(response: { data: unknown; error: { code: string; message: string } | null }): SupabaseClient {
  return { rpc: async () => response } as unknown as SupabaseClient
}

function err(code: string) {
  return { data: null, error: { code, message: `simulated ${code}` } }
}

const ONE = [{ name: 'Ravi', whatsapp_number: N }]

describe('addEngineersToProject: SQLSTATE -> outcome mapping (fake client, no database)', () => {
  const call = (client: SupabaseClient) =>
    addEngineersToProject(client, TEST_PROJECT_A_ID, ONE, { dryRun: true, consent: false })

  it('P0002 no_data_found -> refused project_not_found', async () => {
    expect(await call(fakeClient(err('P0002')))).toEqual({ kind: 'refused', reason: 'project_not_found' })
  })

  it('42501 insufficient_privilege -> refused not_allowed', async () => {
    expect(await call(fakeClient(err('42501')))).toEqual({ kind: 'refused', reason: 'not_allowed' })
  })

  it('23505 unique_violation (the R8 race on users_whatsapp_number_key) -> batch_conflict', async () => {
    expect(await call(fakeClient(err('23505')))).toEqual({ kind: 'batch_conflict' })
  })

  it.each(['22023', '54000', 'XX000', ''])('%j -> error carrying the code, never a refusal', async (code) => {
    expect(await call(fakeClient(err(code)))).toEqual({ kind: 'error', code: code === '' ? null : code })
  })

  it('a response that is not {applied, rows[]} -> error, never trusted', async () => {
    for (const data of [null, 'x', {}, { applied: 'yes', rows: [] }, { applied: true, rows: 'no' }, { applied: true, rows: [{ idx: 'a', status: 'ok' }] }]) {
      expect(await call(fakeClient({ data, error: null })), JSON.stringify(data)).toEqual({ kind: 'error', code: null })
    }
  })

  it('a well-formed response is passed through', async () => {
    const data = { applied: false, rows: [{ idx: 0, status: 'ok' }] }
    expect(await call(fakeClient({ data, error: null }))).toEqual({ kind: 'ok', applied: false, rows: data.rows })
  })

  it('sends exactly the four documented parameters, booleans never NULL', async () => {
    let seen: Record<string, unknown> | null = null
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        seen = args
        return { data: { applied: false, rows: [{ idx: 0, status: 'ok' }] }, error: null }
      },
    } as unknown as SupabaseClient
    await addEngineersToProject(client, TEST_PROJECT_A_ID, ONE, { dryRun: true, consent: false })
    expect(seen).toEqual({
      p_project_id: TEST_PROJECT_A_ID,
      p_engineers: ONE,
      p_dry_run: true,
      p_consent_attested: false,
    })
  })
})

describe('previewEngineers: status -> rejection mapping (fake client, no database)', () => {
  const rows = (statuses: Array<Record<string, unknown>>) =>
    fakeClient({ data: { applied: false, rows: statuses }, error: null })
  const paste = [1, 2, 3, 4, 5].map((k) => `P${k}, ${boundaryDerivedNumber(k)}`).join('\n')

  it('maps every documented status; registered_no_project shows the SAME text as number_registered (D-A4)', async () => {
    const state = await previewEngineers(
      rows([
        { idx: 0, status: 'ok' },
        { idx: 1, status: 'already_on_this_project' },
        { idx: 2, status: 'on_another_project', other_project_name: 'Tower B' },
        { idx: 3, status: 'registered_no_project' },
        { idx: 4, status: 'number_registered' },
      ]),
      TEST_PROJECT_A_ID,
      paste,
    )
    expect(state.kind).toBe('preview')
    if (state.kind !== 'preview') return
    expect(state.rows.map((r) => (r.accepted ? 'accepted' : r.reason))).toEqual([
      'accepted',
      'alreadyOnThisProject',
      'onAnotherProject',
      'inUse',
      'inUse',
    ])
    const another = state.rows[2]
    expect(another.accepted).toBe(false)
    if (!another.accepted) expect(another.otherProjectName).toBe('Tower B')
    expect(state.carried).toEqual([boundaryDerivedNumber(1)])
    expect(state.pasted).toEqual([1, 2, 3, 4, 5].map(boundaryDerivedNumber).sort())
  })

  it('an unknown status is an error, never rendered as accepted', async () => {
    const state = await previewEngineers(
      rows([{ idx: 0, status: 'surprise' }, ...[1, 2, 3, 4].map((i) => ({ idx: i, status: 'ok' }))]),
      TEST_PROJECT_A_ID,
      paste,
    )
    expect(state).toMatchObject({ kind: 'error', error: 'unexpected' })
  })

  it('a row count that does not match what was sent is an error', async () => {
    const state = await previewEngineers(rows([{ idx: 0, status: 'ok' }]), TEST_PROJECT_A_ID, paste)
    expect(state).toMatchObject({ kind: 'error', error: 'unexpected' })
  })

  it('P0002 / 42501 from the RPC become projectNotFound / notAllowed', async () => {
    expect(await previewEngineers(fakeClient(err('P0002')), TEST_PROJECT_A_ID, paste)).toMatchObject({
      kind: 'error',
      error: 'projectNotFound',
    })
    expect(await previewEngineers(fakeClient(err('42501')), TEST_PROJECT_A_ID, paste)).toMatchObject({
      kind: 'error',
      error: 'notAllowed',
    })
  })

  it('empty and oversize pastes are errors before any RPC call', async () => {
    const { client, calls } = spyOn(fakeClient({ data: null, error: null }))
    expect(await previewEngineers(client, TEST_PROJECT_A_ID, '  \n ')).toMatchObject({ kind: 'error', error: 'emptyList' })
    const big = Array.from({ length: 51 }, (_, i) => `P${i}, ${N}`).join('\n')
    expect(await previewEngineers(client, TEST_PROJECT_A_ID, big)).toMatchObject({ kind: 'error', error: 'tooManyLines' })
    expect(calls).toHaveLength(0)
  })
})

describe('the add path on test-db (boundary literal, neutralised project)', () => {
  let db: SupabaseClient
  let jwtA: SupabaseClient
  let fx: TwoTenantFixtures

  async function counts() {
    const one = async (table: string, tenantId: string) => {
      const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      if (error) throw new Error(`count ${table} failed: ${error.message}`)
      return count ?? 0
    }
    return {
      usersA: await one('users', TEST_TENANT_A_ID),
      membersA: await one('project_members', TEST_TENANT_A_ID),
      usersB: await one('users', TEST_TENANT_B_ID),
      membersB: await one('project_members', TEST_TENANT_B_ID),
    }
  }

  async function registeredByAdmin(): Promise<number> {
    const { count, error } = await db.from('users').select('*', { count: 'exact', head: true }).eq('registered_by', fx.profileAId)
    if (error) throw new Error(`count registered_by failed: ${error.message}`)
    return count ?? 0
  }

  async function adminRows(): Promise<number> {
    const { count, error } = await db.from('users').select('*', { count: 'exact', head: true }).eq('id', fx.profileAId)
    if (error) throw new Error(`count admin failed: ${error.message}`)
    return count ?? 0
  }

  beforeAll(async () => {
    db = testClient()
    fx = await ensureTwoTenantFixtures()
    // D-A8 / T21: an EXPLICIT non-active status, never NULL.
    const { error } = await db.from('projects').update({ status: 'on_hold' }).eq('id', TEST_PROJECT_A_ID)
    if (error) throw new Error(`neutralise project A failed: ${error.message}`)
    jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
  }, HOOK_TIMEOUT_MS)

  afterAll(async () => {
    // UNKNOWN #69 (docs/plans, shared-fixture-fk-coverage.json's registered_by
    // note): the FIRST teardown of an engineer created through the RPC.
    // Raw counts before and after, printed one per line for the build log.
    const before = { engineersRegisteredByAdmin: await registeredByAdmin(), adminRow: await adminRows() }
    console.log(`UNKNOWN69 before removeTwoTenantFixtures: ${JSON.stringify(before)}`)
    let teardownError: unknown = null
    try {
      await removeTwoTenantFixtures()
    } catch (e) {
      teardownError = e
      console.log(`UNKNOWN69 removeTwoTenantFixtures THREW: ${e instanceof Error ? e.message : String(e)}`)
    }
    const after = { engineersRegisteredByAdmin: await registeredByAdmin(), adminRow: await adminRows() }
    console.log(`UNKNOWN69 after removeTwoTenantFixtures: ${JSON.stringify(after)}`)
    if (teardownError) throw teardownError
    expect(after).toEqual({ engineersRegisteredByAdmin: 0, adminRow: 0 })
  }, HOOK_TIMEOUT_MS)

  it('the fixture project really is non-active, by an explicit value (T21)', async () => {
    const { data } = await db.from('projects').select('status').eq('id', TEST_PROJECT_A_ID).single()
    expect(data?.status).toBe('on_hold')
  })

  it('preview of a valid paste dry-runs, marks every row accepted, carries the sorted list, and writes NOTHING (T7)', async () => {
    const before = await counts()
    const b = boundaryDerivedNumber(2)
    const { client, calls } = spyOn(jwtA)
    const state = await previewEngineers(client, TEST_PROJECT_A_ID, `Zed, ${b}\nRavi, ${N}`)
    expect(state.kind).toBe('preview')
    if (state.kind !== 'preview') return
    expect(state.rows.every((r) => r.accepted)).toBe(true)
    expect(state.carried).toEqual([N, b].sort())
    expect(state.pasted).toEqual([N, b].sort())
    expect(calls).toHaveLength(1)
    expect(calls[0].args.p_dry_run).toBe(true)
    expect(calls[0].args.p_consent_attested).toBe(false)
    expect(await counts()).toEqual(before)
  })

  it('TS-rejected rows never reach the RPC; only accepted rows are sent', async () => {
    const { client, calls } = spyOn(jwtA)
    const state = await previewEngineers(client, TEST_PROJECT_A_ID, `Ravi, 12345\nAmy, ${N}`)
    expect(state.kind).toBe('preview')
    if (state.kind !== 'preview') return
    expect(state.rows.map((r) => (r.accepted ? 'accepted' : r.reason))).toEqual(['badNumber', 'accepted'])
    expect(calls).toHaveLength(1)
    expect(calls[0].args.p_engineers).toEqual([{ name: 'Amy', whatsapp_number: N }])
  })

  it('a paste with no acceptable row makes no RPC call at all', async () => {
    const { client, calls } = spyOn(jwtA)
    const state = await previewEngineers(client, TEST_PROJECT_A_ID, 'Ravi, 12345')
    expect(state).toMatchObject({ kind: 'preview', carried: [], pasted: [] })
    expect(calls).toHaveLength(0)
  })

  it('a project that does not exist is projectNotFound', async () => {
    const state = await previewEngineers(jwtA, crypto.randomUUID(), `Ravi, ${N}`)
    expect(state).toMatchObject({ kind: 'error', error: 'projectNotFound' })
  })

  it('T46(ii): preview a 2-row paste, then apply with one number SWAPPED (count unchanged, 2 = 2) -> refused, RPC not called, nothing written', async () => {
    const a = N
    const b = boundaryDerivedNumber(2)
    const c = boundaryDerivedNumber(3)
    const preview = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Amy, ${a}\nBen, ${b}`)
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') return
    expect(preview.carried).toHaveLength(2)

    const before = await counts()
    const { client, calls } = spyOn(jwtA)
    const outcome = await applyEngineers(client, TEST_PROJECT_A_ID, `Amy, ${a}\nBen, ${c}`, {
      carried: preview.carried,
      pasted: preview.pasted,
      consent: true,
    })
    expect(outcome.kind).toBe('list_changed')
    expect(calls).toHaveLength(0)
    expect(await counts()).toEqual(before)
  })

  it('T46(ii): dropping a row, adding a row, or emptying the paste is refused too, RPC never called', async () => {
    const a = N
    const b = boundaryDerivedNumber(2)
    const preview = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Amy, ${a}\nBen, ${b}`)
    if (preview.kind !== 'preview') throw new Error('expected preview')
    const carriedArgs = { carried: preview.carried, pasted: preview.pasted, consent: true }
    for (const edited of [
      `Amy, ${a}`,
      `Amy, ${a}\nBen, ${b}\nCal, ${boundaryDerivedNumber(3)}`,
      '',
    ]) {
      const { client, calls } = spyOn(jwtA)
      const outcome = await applyEngineers(client, TEST_PROJECT_A_ID, edited, carriedArgs)
      expect(outcome.kind, JSON.stringify(edited)).toBe('list_changed')
      expect(calls).toHaveLength(0)
    }
  })

  it('a carried list that is not what the paste yields is refused before any RPC call', async () => {
    const preview = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Amy, ${N}`)
    if (preview.kind !== 'preview') throw new Error('expected preview')
    const { client, calls } = spyOn(jwtA)
    const forged = await applyEngineers(client, TEST_PROJECT_A_ID, `Amy, ${N}`, {
      carried: [N, boundaryDerivedNumber(4)],
      pasted: preview.pasted,
      consent: true,
    })
    expect(forged.kind).toBe('list_changed')
    const empty = await applyEngineers(client, TEST_PROJECT_A_ID, `Amy, ${N}`, {
      carried: [],
      pasted: preview.pasted,
      consent: true,
    })
    expect(empty.kind).toBe('list_changed')
    expect(calls).toHaveLength(0)
  })

  it('submitApply on a changed paste re-previews the CURRENT text with the list_changed notice, and never sends an apply', async () => {
    const preview = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Amy, ${N}\nBen, ${boundaryDerivedNumber(2)}`)
    if (preview.kind !== 'preview') throw new Error('expected preview')
    const { client, calls } = spyOn(jwtA)
    const swapped = `Amy, ${N}\nBen, ${boundaryDerivedNumber(3)}`
    const state = await submitApply(client, TEST_PROJECT_A_ID, swapped, {
      carried: preview.carried,
      pasted: preview.pasted,
      consent: true,
    })
    expect(state).toMatchObject({ kind: 'preview', notice: 'list_changed', raw: swapped })
    if (state.kind !== 'preview') return
    expect(state.carried).toEqual([N, boundaryDerivedNumber(3)].sort())
    expect(calls.every((c) => c.args.p_dry_run === true)).toBe(true)
  })

  it('T13 + T46(iii): the boundary literal applies end to end, exactly the carried list lands, columns read back', async () => {
    const before = await counts()
    const preview = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Boundary Engineer, ${N}`)
    if (preview.kind !== 'preview') throw new Error(`expected preview, got ${JSON.stringify(preview)}`)
    expect(preview.carried).toEqual([N])

    const outcome = await applyEngineers(jwtA, TEST_PROJECT_A_ID, `Boundary Engineer, ${N}`, {
      carried: preview.carried,
      pasted: preview.pasted,
      consent: true,
    })
    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') return
    expect(outcome.added).toEqual([{ name: 'Boundary Engineer', number: N }])

    // What landed is exactly the carried list, nothing else (T46 iii).
    const after = await counts()
    expect(after.usersA).toBe(before.usersA + 1)
    expect(after.membersA).toBe(before.membersA + 1)
    expect(after.usersB).toBe(before.usersB)
    expect(after.membersB).toBe(before.membersB)

    // T10 read-back through the service client.
    const { data: user, error } = await db
      .from('users')
      .select('id, tenant_id, role, status, full_name, whatsapp_number, messaging_blocked, auth_id, registered_by, registered_at, consent_attested')
      .eq('whatsapp_number', N)
      .single()
    expect(error).toBeNull()
    expect(user).toMatchObject({
      tenant_id: TEST_TENANT_A_ID,
      role: 'engineer',
      status: 'active',
      full_name: 'Boundary Engineer',
      whatsapp_number: N,
      messaging_blocked: false,
      auth_id: null,
      registered_by: fx.profileAId,
      consent_attested: true,
    })
    expect(user?.registered_at).not.toBeNull()

    const { data: member } = await db
      .from('project_members')
      .select('tenant_id, project_id, role')
      .eq('user_id', user!.id)
      .single()
    expect(member).toEqual({ tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, role: 'engineer' })

    // T14 (PARTIAL): the engineer now resolves to exactly project A. The
    // plan's second T14 clause ("the morning roster includes them") is NOT
    // asserted here: fetchMorningRoster lives under lib/whatsapp/outbound/,
    // which T21 forbids this file to import. Recorded in the build log.
    expect(await resolveEngineerProject(user!.id, db)).toEqual({ outcome: 'resolved', projectId: TEST_PROJECT_A_ID })
  })

  it('the literal is now registered on this project: a second preview rejects it (alreadyOnThisProject)', async () => {
    const state = await previewEngineers(jwtA, TEST_PROJECT_A_ID, `Boundary Engineer, ${N}`)
    if (state.kind !== 'preview') throw new Error('expected preview')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({ accepted: false, reason: 'alreadyOnThisProject' })
    expect(state.carried).toEqual([])
  })

  it('a stale confirmed list that is no longer all-ok applies NOTHING (batch_failed), and submitApply re-previews', async () => {
    const before = await counts()
    const text = `Boundary Engineer, ${N}`
    // The carried list a browser would still be holding from before the first apply.
    const stale = { carried: [N], pasted: [N], consent: true }
    const outcome = await applyEngineers(jwtA, TEST_PROJECT_A_ID, text, stale)
    expect(outcome.kind).toBe('batch_failed')
    expect(await counts()).toEqual(before)

    const state = await submitApply(jwtA, TEST_PROJECT_A_ID, text, stale)
    expect(state).toMatchObject({ kind: 'preview', notice: 'batch_failed' })
    expect(await counts()).toEqual(before)
  })
})
