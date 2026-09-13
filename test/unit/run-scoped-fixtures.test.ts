// Batch 1 of the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md). Pure-function unit
// tests -- no real test-db needed for getRunId/deriveRunScopedUuid; a fake
// minimal client for assertExactRowCount, per its own CountableClient shape.
import { describe, it, expect } from 'vitest'
import {
  getRunId,
  deriveRunScopedUuid,
  deriveRunScopedPhone,
  deriveRunScopedEmail,
  deriveRunScopedPhoneBlock,
  assertExactRowCount,
} from '../helpers/run-scoped-fixtures'

describe('getRunId', () => {
  it('returns the run id provided by globalSetup (this run really has one)', () => {
    const id = getRunId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

describe('deriveRunScopedUuid', () => {
  it('is deterministic: same (runId, label) always produces the same value', () => {
    const a = deriveRunScopedUuid('run-1', 'TEST_TENANT_ID')
    const b = deriveRunScopedUuid('run-1', 'TEST_TENANT_ID')
    expect(a).toBe(b)
  })

  it('produces a different value for a different label under the same run', () => {
    const tenant = deriveRunScopedUuid('run-1', 'TEST_TENANT_ID')
    const project = deriveRunScopedUuid('run-1', 'TEST_PROJECT_ID')
    expect(tenant).not.toBe(project)
  })

  it('produces a different value for a different run under the same label', () => {
    const runA = deriveRunScopedUuid('run-A', 'TEST_TENANT_ID')
    const runB = deriveRunScopedUuid('run-B', 'TEST_TENANT_ID')
    expect(runA).not.toBe(runB)
  })

  it('is shaped like a UUID (8-4-4-4-12 hex, version/variant nibbles forced)', () => {
    const id = deriveRunScopedUuid('run-1', 'TEST_TENANT_ID')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("this run's actual injected id derives a different value per label (real getRunId, not a fake string)", () => {
    const runId = getRunId()
    const a = deriveRunScopedUuid(runId, 'A')
    const b = deriveRunScopedUuid(runId, 'B')
    expect(a).not.toBe(b)
  })
})

describe('deriveRunScopedPhone', () => {
  it('is deterministic: same (runId, label) always produces the same value', () => {
    const a = deriveRunScopedPhone('run-1', 'TEST_ENGINEER_PHONE')
    const b = deriveRunScopedPhone('run-1', 'TEST_ENGINEER_PHONE')
    expect(a).toBe(b)
  })

  it('produces a different value for a different run under the same label', () => {
    const runA = deriveRunScopedPhone('run-A', 'TEST_ENGINEER_PHONE')
    const runB = deriveRunScopedPhone('run-B', 'TEST_ENGINEER_PHONE')
    expect(runA).not.toBe(runB)
  })

  it('is shaped like a phone number in the +19995552NNNNNN space -- disjoint from the registry (+19995550NNN) and the outbound suite (+19995551NNNNNN)', () => {
    const phone = deriveRunScopedPhone('run-1', 'TEST_ENGINEER_PHONE')
    expect(phone).toMatch(/^\+19995552\d{6}$/)
  })

  it('does not produce the same raw digest as deriveRunScopedUuid for the same (runId, label) -- independent hash input', () => {
    const uuid = deriveRunScopedUuid('run-1', 'TEST_ENGINEER_PHONE')
    const phone = deriveRunScopedPhone('run-1', 'TEST_ENGINEER_PHONE')
    // Different shapes entirely, but assert on substance, not just shape:
    // the phone's digits should not simply be a substring of the uuid's hex.
    expect(uuid.replace(/-/g, '')).not.toContain(phone.replace('+19995552', ''))
  })
})

describe('deriveRunScopedEmail', () => {
  it('is deterministic: same (runId, label) always produces the same value', () => {
    const a = deriveRunScopedEmail('run-1', 'TEST_007_USER_A_EMAIL')
    const b = deriveRunScopedEmail('run-1', 'TEST_007_USER_A_EMAIL')
    expect(a).toBe(b)
  })

  it('produces a different value for a different label under the same run (A vs B)', () => {
    const a = deriveRunScopedEmail('run-1', 'TEST_007_USER_A_EMAIL')
    const b = deriveRunScopedEmail('run-1', 'TEST_007_USER_B_EMAIL')
    expect(a).not.toBe(b)
  })

  it('produces a different value for a different run under the same label', () => {
    const runA = deriveRunScopedEmail('run-A', 'TEST_007_USER_A_EMAIL')
    const runB = deriveRunScopedEmail('run-B', 'TEST_007_USER_A_EMAIL')
    expect(runA).not.toBe(runB)
  })

  it('is a syntactically valid email at the fixed, obviously-fake quoco.test domain', () => {
    const email = deriveRunScopedEmail('run-1', 'TEST_007_USER_A_EMAIL')
    expect(email).toMatch(/^zz-test-[0-9a-f]{12}@quoco\.test$/)
  })
})

describe('deriveRunScopedPhoneBlock', () => {
  it('is deterministic: same runId always produces the same block', () => {
    const a = deriveRunScopedPhoneBlock('run-1')
    const b = deriveRunScopedPhoneBlock('run-1')
    expect(a).toBe(b)
  })

  it('produces a different block for a different run', () => {
    const runA = deriveRunScopedPhoneBlock('run-A')
    const runB = deriveRunScopedPhoneBlock('run-B')
    expect(runA).not.toBe(runB)
  })

  it('is a 5-digit, zero-padded decimal string -- no label argument, one block per run', () => {
    const block = deriveRunScopedPhoneBlock('run-1')
    expect(block).toMatch(/^\d{5}$/)
  })
})

describe('assertExactRowCount', () => {
  // A fake QUERY, not a fake client -- assertExactRowCount takes a callback
  // returning the awaitable result, deliberately keeping Supabase's own
  // client type out of its signature (see the function's own header for
  // why: structurally typing against a real SupabaseClient triggered a
  // "Type instantiation is excessively deep" TS error when this was wired
  // into ensureMorningFixtures()). So the fake here is trivial: a function
  // that resolves to canned data, nothing to construct a chain for.
  function fakeQuery(count: number | null, errorMessage?: string) {
    return async () => ({ count, error: errorMessage ? { message: errorMessage } : null })
  }

  it('resolves silently when the count matches exactly', async () => {
    await expect(
      assertExactRowCount({
        query: fakeQuery(1),
        table: 'projects',
        column: 'tenant_id',
        value: 'some-uuid',
        expected: 1,
        context: 'test',
      }),
    ).resolves.toBeUndefined()
  })

  it('throws when the count is higher than expected (a collision or leftover row)', async () => {
    await expect(
      assertExactRowCount({
        query: fakeQuery(2),
        table: 'projects',
        column: 'tenant_id',
        value: 'some-uuid',
        expected: 1,
        context: 'after seeding',
      }),
    ).rejects.toThrow(/expected exactly 1 row\(s\).*found 2/)
  })

  it('throws when the count is lower than expected (this run\'s own row is missing)', async () => {
    await expect(
      assertExactRowCount({
        query: fakeQuery(0),
        table: 'projects',
        column: 'tenant_id',
        value: 'some-uuid',
        expected: 1,
        context: 'after seeding',
      }),
    ).rejects.toThrow(/found 0/)
  })

  it('throws on a query error rather than silently treating it as zero', async () => {
    await expect(
      assertExactRowCount({
        query: fakeQuery(null, 'connection reset'),
        table: 'projects',
        column: 'tenant_id',
        value: 'some-uuid',
        expected: 1,
        context: 'test',
      }),
    ).rejects.toThrow(/query failed: connection reset/)
  })
})
