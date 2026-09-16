import { describe, it, expect } from 'vitest'
import { testClient } from './helpers/db'

// D4 (docs/reviews/047-review-package.md; migration 047, revoke unused
// table rights). LIVE TEST, per Aravind's 2026-09-16 decision -- this
// REPLACES the prior static source guard entirely (that guard parsed
// migration 047's own SQL text; this test instead queries the real
// database, the same shape test/session-transition.test.ts already uses
// for quoco_test_row_is_locked).
//
// THE HELPER THIS TEST DEPENDS ON: quoco_test_047_unused_rights_check(),
// docs/reviews/048_test_047_unused_rights_check.sql -- HELD, NOT YET
// APPLIED anywhere, per that file's own header. Must be applied to
// TEST-DB ONLY, alongside migration 047's own test-db rehearsal (a later
// pass), before this test can pass. Until then, this test is EXPECTED TO
// FAIL with a clear, named error -- never skipped, never silently green.
//
// CI ON THIS PR WILL FAIL on this file until 047 and 048 are both applied
// to test-db. Expected, per this project's own stated order: external
// review -> test-db -> CI -> merge -> PITR -> prod (D6). A red check here,
// before that apply happens, is not a bug in this test.

describe('migration 047 — live D4 check (no unused table rights remain)', () => {
  it('quoco_test_047_unused_rights_check() reports zero unused grants and zero delete-command policies in public', async () => {
    const db = testClient()
    const { data, error } = await db.rpc('quoco_test_047_unused_rights_check')

    if (error) {
      throw new Error(
        `migration-047 D4 check FAILED to call quoco_test_047_unused_rights_check() -- ` +
          `either the helper (docs/reviews/048_test_047_unused_rights_check.sql) has not ` +
          `been applied to test-db yet, or migration 047 itself has not been applied yet. ` +
          `This must fail loudly, never be skipped: Postgres error ${error.code ?? '(no code)'} -- ${error.message}`,
      )
    }

    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error(
        'migration-047 D4 check: quoco_test_047_unused_rights_check() returned no rows -- ' +
          'expected exactly one row with grant_count and policy_count. Cannot assert the ' +
          'invariant with no data to check.',
      )
    }

    const row = (Array.isArray(data) ? data[0] : data) as { grant_count: number | string; policy_count: number | string }
    const grantCount = Number(row.grant_count)
    const policyCount = Number(row.policy_count)

    expect(grantCount, 'grant_count: remaining DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN grants to anon/authenticated on public tables').toBe(0)
    expect(policyCount, "policy_count: remaining polcmd 'd' (DELETE) RLS policies in public").toBe(0)
  })
})
