// Built in batch 1 of the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md): pure derivation +
// the one guard that catches a straggler call site silently sharing state
// with another run instead of being genuinely isolated. Wired into the
// morning-fixture family (TEST_TENANT_ID/TEST_PROJECT_ID/TEST_ENGINEER_PHONE,
// test/helpers/db.ts) starting batch 2.

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

// Same derivation as deriveRunScopedUuid, formatted as a phone number instead
// of a UUID -- for the ONE fixture identity that needs a phone-shaped value:
// the single shared morning-flow engineer's own WhatsApp number
// (TEST_ENGINEER_PHONE, test/helpers/db.ts), which batch 2 treats as
// "derived from" the tenant/project it belongs to, not as part of the
// general per-test phone-slot registry (TEST_PHONE_PREFIX + ~98 hand-
// registered slots, deferred to batch 4 -- see the design doc's decision 3).
//
// DELIBERATELY A DIFFERENT, DISJOINT PREFIX DIGIT from both existing phone
// spaces, so this can never collide with either mechanism it is NOT part of:
// `+19995550NNN` (the batch-4 registry, 3-digit slots) and `+19995551NNNNNN`
// (the outbound suite's own wholesale-random range). This one is
// `+19995552NNNNNN` -- reserved here, and in test/helpers/db.ts's own
// RESERVED PHONE/PREFIX BLOCKS comment, so a future author doesn't hand-pick
// a slot under it by mistake the same way the `03XX` incident happened once
// already (db.ts's own comment on that incident).
export function deriveRunScopedPhone(runId: string, label: string): string {
  const digest = createHash('sha256').update(`${runId}:${label}:phone`).digest()
  // 4 bytes -> a uint32 -> mod 1_000_000 gives 6 decimal digits, zero-padded.
  // Independent hash input (":phone" suffix) from deriveRunScopedUuid's, so
  // the same (runId, label) pair used for both never coincidentally produces
  // related-looking values.
  const n = digest.readUInt32BE(0) % 1_000_000
  return `+19995552${n.toString().padStart(6, '0')}`
}

// The result shape any count-style PostgREST query resolves to -- what
// `.select('*', {count:'exact', head:true})...` always returns, regardless
// of which table/column/filter built it.
interface CountResult {
  count: number | null
  error: { message: string } | null
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
// Takes a QUERY, not a client/table/column triple: the caller builds the
// actual Supabase query itself (using the real, fully-typed SupabaseClient)
// and passes only the resulting awaitable. This deliberately keeps
// Supabase's own client type entirely out of this function's signature --
// structurally typing against SupabaseClient's real generic query-builder
// chain here triggered "Type instantiation is excessively deep" from
// TypeScript (confirmed while wiring this into ensureMorningFixtures()) --
// and it makes unit-testing trivial: a fake `query` is just a function
// returning canned data, no fake client chain to construct at all.
//
// Never treat a failure here as flaky and re-run -- per this project's own
// standing rule on exactly this shape of check (CLAUDE.md's REHEARSAL
// REQUIREMENT / shared-fixture entries), a mismatch here means either a
// genuine collision with another run or a leftover row nobody cleaned up,
// and both need investigating, not retrying.
export async function assertExactRowCount(params: {
  query: () => PromiseLike<CountResult>
  table: string
  column: string
  value: string
  expected: number
  context: string
}): Promise<void> {
  const { query, table, column, value, expected, context } = params
  const { count, error } = await query()
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
