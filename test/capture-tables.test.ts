// c, d, f (helper insert, tenant guard, N-4 E12 via helper) deferred to PR-B per 2026-10-12 2b ruling.
//
// 049 capture tables: grant, helper and bucket checks against test-db. No fixtures, no writes:
// every write-type call below is expected to be REFUSED, and the rest are reads.
// Untyped clients (D-24): types/database.ts does not contain these tables until after the prod apply.
// URL and keys come from the SUPABASE_TEST_* vars (the same ones test/helpers/db.ts uses); the allowlist guard
// (test/setup/guard.ts) has already proven they point at test-db before any test runs.
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_TEST_URL!
const opts = { auth: { persistSession: false } }
const svc = createClient(url, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, opts)
const anon = createClient(url, process.env.SUPABASE_TEST_ANON_KEY!, opts)

const TABLES = ['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links'] as const
const APPROVED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

describe('049 capture tables (test-db)', () => {
  describe('a. anon SELECT is refused', () => {
    it.each(TABLES)('%s', async (t) => {
      const { data, error } = await anon.from(t).select('*').limit(1)
      expect(error?.code).toBe('42501')
      expect(data).toBeNull()
    })
  })

  describe('b. service_role: SELECT succeeds, INSERT {} is refused', () => {
    it.each(TABLES)('%s SELECT', async (t) => {
      const { data, error } = await svc.from(t).select('*').limit(1)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })
    it.each(TABLES)('%s INSERT {}', async (t) => {
      const { error } = await svc.from(t).insert({})
      expect(error?.code).toBe('42501')
    })
  })

  it('e. helpers_present() returns true for service_role', async () => {
    const { data, error } = await svc.rpc('quoco_test_capture_helpers_present')
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('g. the capture-documents bucket has the approved settings', async () => {
    const { data, error } = await svc.storage.getBucket('capture-documents')
    expect(error).toBeNull()
    expect(data?.public).toBe(false)
    expect(data?.file_size_limit).toBe(16777216)
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([...APPROVED_MIME].sort())
  })

  it('H14. quoco_test_capture_acl() reports exactly six definer trigger functions with an empty search_path', async () => {
    const { data, error } = await svc.rpc('quoco_test_capture_acl')
    expect(error).toBeNull()
    const fns = (data as { functions: Record<string, { prosecdef: boolean; proconfig: string[] | null }> }).functions
    const ok = Object.values(fns).filter(
      (f) => f.prosecdef === true && Array.isArray(f.proconfig) && f.proconfig.length === 1 && f.proconfig[0] === 'search_path=""',
    )
    expect(Object.keys(fns)).toHaveLength(6)
    expect(ok).toHaveLength(6)
  })
})
