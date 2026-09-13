// Batch 1 of the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md). Pure derivation +
// the one guard that catches a straggler call site silently sharing state
// with another run instead of being genuinely isolated -- built here,
// wired into a real fixture family starting batch 2, not before.
//
// NOT YET WIRED INTO ANY FIXTURE. test/helpers/db.ts's TEST_TENANT_ID and
// friends keep their current literal values through this batch -- zero
// behaviour change, per the design doc's batch 1 scope. This file exists,
// is exported, and is unit-tested on its own; nothing calls it yet.

import { createHash } from 'node:crypto'
import { inject } from 'vitest'

// Wraps inject() so every call site imports one thing from one place,
// rather than importing `inject` from 'vitest' directly and repeating the
// key name/cast everywhere. Safe to call at plain module top-level (verified
// empirically -- see run-id.ts's header): by the time any test file's own
// module graph is evaluated, globalSetup has already run and provided this.
export function getRunId(): string {
  return inject('quocoTestRunId')
}

// Deterministically derive a stable, UUID-SHAPED identifier from this run's
// id plus a human-readable label (e.g. "TEST_TENANT_ID"). Same (runId,
// label) always produces the same output -- this is what lets every test
// file independently compute the identical value for, say, "this run's
// morning-flow tenant" without needing a separate provide()/inject() key
// per fixture slot: one injected run id, N pure derivations, computed
// locally wherever needed.
//
// NOT a real UUID v5 (RFC 4122's namespace+name scheme is SHA-1-based with
// specific namespace-UUID handling) -- this is a plain SHA-256-of-a-string
// truncated to 128 bits and formatted into the 8-4-4-4-12 hex shape every
// uuid-typed column here expects. Postgres does not validate version/variant
// nibbles; only that shape matters for a value to be accepted as a UUID
// literal. The version/variant nibbles below are forced into their
// conventional ranges (4, and 8/9/a/b) purely so a human glancing at a
// derived value still recognises it as UUID-shaped -- nothing depends on
// them being exactly that.
export function deriveRunScopedUuid(runId: string, label: string): string {
  const digest = createHash('sha256').update(`${runId}:${label}`).digest()
  const bytes = digest.subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Minimal shape this needs from a Supabase client -- narrower than the real
// SupabaseClient type so a unit test can pass a plain object implementing
// just this chain, without constructing (or mocking the internals of) a
// real client. Mirrors this table's actual PostgREST call shape exactly:
// .from(table).select('*', {count:'exact', head:true}).eq(column, value).
interface CountableClient {
  from(table: string): {
    select(
      columns: string,
      opts: { count: 'exact'; head: true },
    ): {
      eq(column: string, value: string): Promise<{ count: number | null; error: { message: string } | null }>
    }
  }
}

// Guard (b): the check that catches silent isolation failure, not just a
// green suite. A fixture helper calls this immediately after seeding a
// run-scoped row, asserting the row count under THIS run's identifier is
// EXACTLY what this run itself created -- no more, no less. If some call
// site still resolves to a shared/stale identifier (a straggler literal,
// a missed migration, a copy-paste), this fails loudly and specifically,
// rather than the suite passing because its own assertions are scoped by
// that same wrong identifier and can't tell the difference on their own.
//
// Never treat a failure here as flaky and re-run -- per this project's own
// standing rule on exactly this shape of check (CLAUDE.md's REHEARSAL
// REQUIREMENT / shared-fixture entries), a mismatch here means either a
// genuine collision with another run or a leftover row nobody cleaned up,
// and both need investigating, not retrying.
export async function assertExactRowCount(params: {
  client: CountableClient
  table: string
  column: string
  value: string
  expected: number
  context: string
}): Promise<void> {
  const { client, table, column, value, expected, context } = params
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true }).eq(column, value)
  if (error) {
    throw new Error(`assertExactRowCount(${table}.${column}) query failed: ${error.message}`)
  }
  if (count !== expected) {
    throw new Error(
      `assertExactRowCount FAILED (${context}): expected exactly ${expected} row(s) in ${table} where ` +
        `${column} = ${value}, found ${count ?? 'null'}. This means the identifier is not actually isolated -- ` +
        `either it collided with another run's data, or a stale/leftover row already exists under this exact ` +
        `value. Investigate before re-running; do not treat this as flaky.`,
    )
  }
}
