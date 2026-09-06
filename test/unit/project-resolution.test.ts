import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  resolveEngineerProject,
  replyForProjectResolution,
  ZERO_MEMBERSHIPS_REPLY,
  MULTIPLE_MEMBERSHIPS_REPLY,
} from '@/lib/whatsapp/project-resolution'
import { testClient, ensureTestTenant, TEST_TENANT_ID } from '../helpers/db'

// Ad-hoc menu PR 2, step 3. Real test-db throughout, no mocks -- same
// construction as every other integration test in this project. Fully
// self-contained fixtures (own users, own projects) rather than reusing
// the shared morning-flow fixture, since this needs three distinct
// membership shapes (0, 1, 2+) that fixture was never built to provide.
//
// project_members carries UNIQUE(project_id, user_id) (001_core_schema.sql)
// -- the 2+-membership case needs two DISTINCT projects, not two rows
// against the same one.
//
// CI CAUGHT (2026-09-06): the first draft's beforeAll inserted directly
// into `projects` under TEST_TENANT_ID without ensuring that tenant row
// exists first -- other test files' own ensureMorningFixtures() happens to
// upsert it as a side effect, but vitest test files run independently
// (parallelizable, no guaranteed ordering), so this file cannot rely on
// another file's setup having already run. ensureTestTenant() is the
// dedicated, idempotent helper for exactly this (test/helpers/db.ts).

const db = testClient()

let projectA: string
let projectB: string
let userZero: string
let userOne: string
let userMany: string

beforeAll(async () => {
  await ensureTestTenant()

  const { data: pA, error: pAErr } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: 'ZZ Test Project Resolution A' })
    .select('id')
    .single<{ id: string }>()
  if (pAErr || !pA) throw new Error(`project A insert failed: ${pAErr?.message}`)
  projectA = pA.id

  const { data: pB, error: pBErr } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: 'ZZ Test Project Resolution B' })
    .select('id')
    .single<{ id: string }>()
  if (pBErr || !pB) throw new Error(`project B insert failed: ${pBErr?.message}`)
  projectB = pB.id

  async function makeUser(label: string): Promise<string> {
    const { data, error } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_ID,
        full_name: `ZZ Test Project Resolution (${label})`,
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        whatsapp_number: null,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (error || !data) throw new Error(`user insert failed (${label}): ${error?.message}`)
    return data.id
  }

  userZero = await makeUser('zero')
  userOne = await makeUser('one')
  userMany = await makeUser('many')

  const { error: memErr } = await db.from('project_members').insert([
    { tenant_id: TEST_TENANT_ID, project_id: projectA, user_id: userOne, role: 'engineer' },
    { tenant_id: TEST_TENANT_ID, project_id: projectA, user_id: userMany, role: 'engineer' },
    { tenant_id: TEST_TENANT_ID, project_id: projectB, user_id: userMany, role: 'engineer' },
  ])
  if (memErr) throw new Error(`project_members insert failed: ${memErr.message}`)
})

afterAll(async () => {
  await db.from('project_members').delete().in('project_id', [projectA, projectB])
  await db.from('users').delete().in('id', [userZero, userOne, userMany])
  await db.from('projects').delete().in('id', [projectA, projectB])
})

describe('resolveEngineerProject', () => {
  it('resolves cleanly when the engineer has exactly one membership', async () => {
    const result = await resolveEngineerProject(userOne, db)
    expect(result).toEqual({ outcome: 'resolved', projectId: projectA })
  })

  it('reports zero_memberships when the engineer has no project_members row', async () => {
    const result = await resolveEngineerProject(userZero, db)
    expect(result).toEqual({ outcome: 'zero_memberships' })
  })

  it('reports multiple_memberships, with the real count, when the engineer has 2+ rows', async () => {
    const result = await resolveEngineerProject(userMany, db)
    expect(result).toEqual({ outcome: 'multiple_memberships', count: 2 })
  })

  it('never trusts a caller-supplied projectId -- there is no such parameter to misuse', () => {
    // Compile-time guard, not a runtime assertion: resolveEngineerProject's
    // own signature (userId, supabaseClient) has no projectId parameter at
    // all. Documented here as an explicit regression guard -- if a future
    // edit adds one "for convenience," this comment is where a reviewer
    // should stop and ask why (Aravind's own ruling, 2026-09-06: reusing
    // route.ts's threaded value would reintroduce the exact bug this
    // function exists to fix).
    expect(resolveEngineerProject.length).toBe(2)
  })
})

describe('replyForProjectResolution', () => {
  it('returns the zero-memberships copy', () => {
    expect(replyForProjectResolution({ outcome: 'zero_memberships' })).toBe(ZERO_MEMBERSHIPS_REPLY)
  })

  it('returns the multiple-memberships copy, regardless of the exact count', () => {
    expect(replyForProjectResolution({ outcome: 'multiple_memberships', count: 5 })).toBe(
      MULTIPLE_MEMBERSHIPS_REPLY,
    )
  })

  it('throws on a resolved outcome -- callers must branch before reaching for copy', () => {
    expect(() => replyForProjectResolution({ outcome: 'resolved', projectId: projectA })).toThrow()
  })
})
