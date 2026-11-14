import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Sentry is only reached from error paths of pm-queries; keep it inert in this node test.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { readEngineerNames } from '@/lib/capture/pm-queries'
import { linkOptionLabel } from '@/components/material-inward/labels'

// R4 (PR-D1b): the engineer-name lookup for the link picker is NEW tenant-scoped reading. A user id that belongs to another
// tenant must never produce that user's name for this reader. This test uses an in-memory stand-in for the users table that
// applies the same eq / in filters PostgREST would, so it is node-only and needs no database.
//
// WHAT THE CODE GIVES: the candidate STAYS in the picker and its name is null, which the label renders as an em dash.
// (It is not excluded.) Real data cannot reach this case anyway: deliveries.reported_by and capture_documents.sent_by carry a
// same-tenant composite FK (049). This is defence in depth, and the control below proves the filter is what makes it hold.

const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const USER_A = 'a1a1a1a1-0000-4000-8000-0000000000a1'
const USER_B = 'b2b2b2b2-0000-4000-8000-0000000000b2'

interface Row {
  id: string
  tenant_id: string
  full_name: string | null
}
const USERS: Row[] = [
  { id: USER_A, tenant_id: TENANT_A, full_name: 'Asha A' },
  { id: USER_B, tenant_id: TENANT_B, full_name: 'Bharath B' },
]

function fakeClient(rows: Row[], seen: { table: string; columns: string }[]): SupabaseClient<Database> {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const b = {
        select(columns: string) {
          seen.push({ table, columns })
          return b
        },
        eq(col: keyof Row, v: string) {
          filters.push((r) => r[col] === v)
          return b
        },
        in(col: keyof Row, vs: string[]) {
          filters.push((r) => vs.includes(r[col] as string))
          return b
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
        },
      }
      return b
    },
  } as unknown as SupabaseClient<Database>
}

describe('R4: readEngineerNames is scoped to the reader\'s tenant', () => {
  it('a same-tenant engineer resolves to their name', async () => {
    const r = await readEngineerNames(fakeClient(USERS, []), TENANT_A, [USER_A])
    expect(r.ok && r.names.get(USER_A)).toBe('Asha A')
  })

  it('TENANT B\'s user never shows B\'s name to a tenant A reader: no name, and the picker label shows an em dash', async () => {
    const r = await readEngineerNames(fakeClient(USERS, []), TENANT_A, [USER_A, USER_B])
    if (!r.ok) throw new Error('lookup failed')
    expect(r.names.has(USER_B)).toBe(false)
    expect([...r.names.values()]).not.toContain('Bharath B')
    const label = linkOptionLabel(
      { receivedAt: '2026-11-02T05:03:00Z', documentCreatedAt: null, engineerName: r.names.get(USER_B) ?? null, ack: 'yes', kindSource: 'engineer_declared' },
      'dc',
    )
    expect(label).toContain(' · — · ')
    expect(label).not.toContain('Bharath')
  })

  it('POSITIVE CONTROL: the same lookup for tenant B DOES return B\'s name (the fixture really holds it)', async () => {
    const r = await readEngineerNames(fakeClient(USERS, []), TENANT_B, [USER_B])
    expect(r.ok && r.names.get(USER_B)).toBe('Bharath B')
  })

  it('selects only id and full_name from users (no phone, no email)', async () => {
    const seen: { table: string; columns: string }[] = []
    await readEngineerNames(fakeClient(USERS, seen), TENANT_A, [USER_A])
    expect(seen).toEqual([{ table: 'users', columns: 'id, full_name' }])
  })

  it('no ids: no query at all', async () => {
    const seen: { table: string; columns: string }[] = []
    const r = await readEngineerNames(fakeClient(USERS, seen), TENANT_A, [])
    expect(r.ok && r.names.size).toBe(0)
    expect(seen).toEqual([])
  })
})
