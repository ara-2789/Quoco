// Batch 1 of the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md). Pure-function unit
// tests -- no real test-db needed for getRunId/deriveRunScopedUuid; a fake
// minimal client for assertExactRowCount, per its own CountableClient shape.
import { describe, it, expect } from 'vitest'
import { getRunId, deriveRunScopedUuid, assertExactRowCount } from '../helpers/run-scoped-fixtures'

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

describe('assertExactRowCount', () => {
  // Deliberately ignores every argument -- this fake only needs to return a
  // canned {count, error} response; it never has to inspect what it was
  // called with. Fewer params than CountableClient declares is fine here:
  // TS allows a function to be assigned where one accepting MORE arguments
  // is expected, since callers passing extra arguments than a function
  // reads is always safe.
  function fakeClient(count: number | null, errorMessage?: string) {
    return {
      from: () => ({
        select: () => ({
          eq: async () => ({
            count,
            error: errorMessage ? { message: errorMessage } : null,
          }),
        }),
      }),
    }
  }

  it('resolves silently when the count matches exactly', async () => {
    await expect(
      assertExactRowCount({
        client: fakeClient(1),
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
        client: fakeClient(2),
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
        client: fakeClient(0),
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
        client: fakeClient(null, 'connection reset'),
        table: 'projects',
        column: 'tenant_id',
        value: 'some-uuid',
        expected: 1,
        context: 'test',
      }),
    ).rejects.toThrow(/query failed: connection reset/)
  })
})
