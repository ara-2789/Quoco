import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProjectManagerName } from '@/lib/dpr/project-manager'

// Pure/mocked unit tests for resolveProjectManagerName's two review-round-2
// behaviours (2026-09-11, docs/plans/dpr-format-redesign.md §5): the
// multi-PM Sentry warning, and fail-soft on both DB error paths. The 1:1
// happy path and the real-test-db "does not pick up a non-PM member" case
// are already covered by test/dpr-stage1-plumbing.test.ts against real
// test-db -- this file exists for the two branches a real DB call cannot
// reliably trigger (a genuine project_members/users read failure) or that
// are cheaper and more precise to assert with a controlled fixture (the
// exact Sentry payload shape on an ambiguous PM count).
//
// Same @sentry/nextjs mocking convention as test/dpr-generate-trigger.test.ts
// (vi.hoisted + importOriginal, only capture* replaced) -- named-export
// mutation under ESM requires this shape, vi.spyOn cannot redefine it.
const { captureMessageMock, captureExceptionMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}))
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  return { ...actual, captureMessage: captureMessageMock, captureException: captureExceptionMock }
})

type QueryResult<T> = { data: T | null; error: { message: string } | null }

function makeFakeClient(opts: {
  memberships: QueryResult<Array<{ user_id: string }>>
  user?: QueryResult<{ full_name: string | null }>
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'project_members') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => Promise.resolve(opts.memberships),
        }
        return builder
      }
      if (table === 'users') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve(opts.user ?? { data: null, error: null }),
        }
        return builder
      }
      throw new Error(`makeFakeClient: unexpected table "${table}"`)
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  captureMessageMock.mockClear()
  captureExceptionMock.mockClear()
})

describe('resolveProjectManagerName — multi-PM visibility (review round 2, item 1)', () => {
  it('one PM: resolves the name, fires no Sentry warning', async () => {
    const client = makeFakeClient({
      memberships: { data: [{ user_id: 'pm-1' }], error: null },
      user: { data: { full_name: 'Solo PM' }, error: null },
    })
    const name = await resolveProjectManagerName(client, 'project-1')
    expect(name).toBe('Solo PM')
    expect(captureMessageMock).not.toHaveBeenCalled()
  })

  it("two+ PMs: still returns the first (by the DB's own created_at order), AND fires a Sentry warning naming the project and the count", async () => {
    const client = makeFakeClient({
      memberships: { data: [{ user_id: 'pm-first' }, { user_id: 'pm-second' }], error: null },
      user: { data: { full_name: 'First PM' }, error: null },
    })
    const name = await resolveProjectManagerName(client, 'project-ambiguous')
    expect(name).toBe('First PM') // behaviour unchanged -- still one name, deterministic
    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessageMock.mock.calls[0]
    expect(message).toContain('more than one')
    expect(options.level).toBe('warning')
    expect(options.extra).toEqual({ project_id: 'project-ambiguous', count: 2 })
  })

  it('zero PMs: returns null, fires no warning (not an ambiguity case)', async () => {
    const client = makeFakeClient({ memberships: { data: [], error: null } })
    const name = await resolveProjectManagerName(client, 'project-none')
    expect(name).toBeNull()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })
})

describe('resolveProjectManagerName — fails soft, never throws (review round 2, item 2)', () => {
  it('a project_members read failure returns null and captures to Sentry, does not throw', async () => {
    const client = makeFakeClient({
      memberships: { data: null, error: { message: 'connection reset' } },
    })
    const name = await resolveProjectManagerName(client, 'project-db-down')
    expect(name).toBeNull()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [, options] = captureExceptionMock.mock.calls[0]
    expect(options.extra).toEqual({ project_id: 'project-db-down', stage: 'project_members lookup' })
  })

  it('a users read failure returns null and captures to Sentry, does not throw', async () => {
    const client = makeFakeClient({
      memberships: { data: [{ user_id: 'pm-1' }], error: null },
      user: { data: null, error: { message: 'connection reset' } },
    })
    const name = await resolveProjectManagerName(client, 'project-users-down')
    expect(name).toBeNull()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [, options] = captureExceptionMock.mock.calls[0]
    expect(options.extra).toEqual({ project_id: 'project-users-down', stage: 'users lookup' })
  })
})
