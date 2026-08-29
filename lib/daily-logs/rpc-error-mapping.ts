// Pure classification of a correct_daily_log RPC error into UI copy — no
// React, no Supabase, no Sentry. Framework-free like correction.ts/date.ts,
// deliberately: the Server Action (app/(dashboard)/daily-logs/actions.ts)
// depends on next/headers' cookies() transitively and so cannot be exercised
// directly under plain vitest (no Next.js request context outside a real
// render) — this is the seam that CAN be unit-tested
// (test/unit/rpc-error-mapping.test.ts), with the actual Sentry reporting
// left to the thin Server Action wrapper that calls this.
//
// Every guard proven in test/migration-019.test.ts is keyed on error.code /
// SQLSTATE, never message text (the suite's own stated convention) — this
// mirrors that: no `error.message.includes(...)` branching anywhere here.

export type RpcErrorClassification = {
  kind: 'forbidden' | 'not-found' | 'too-large' | 'unknown'
  message: string
  /**
   * True when the caller should Sentry.captureException this — a genuine
   * defense-in-depth failure (the UI offered an action it shouldn't have, or
   * an unmapped condition), never for a legitimate concurrent-edit race.
   */
  reportToSentry: boolean
}

export function classifyRpcError(error: { code?: string; message: string }): RpcErrorClassification {
  // 42501 (insufficient_privilege) — PM-only + membership guard
  // (T-019-03/04/07) and the anon-ACL REVOKE (T-019-09) all raise this. With
  // the role gate in place (edit affordances render only for role==='pm'
  // project members), reaching this means the UI offered an action it
  // shouldn't have — a genuine defense-in-depth failure, not a routine
  // consequence of an ungated surface.
  if (error.code === '42501') {
    return {
      kind: 'forbidden',
      message: "You don't have permission to make this change.",
      reportToSentry: true,
    }
  }

  // P0002 (no_data_found) — 019 guard (d): the target row was deleted
  // between page load and save. A legitimate concurrent-edit race, not a
  // bug — deliberately NOT reported, distinct from the 42501 case.
  if (error.code === 'P0002') {
    return { kind: 'not-found', message: 'This entry no longer exists.', reportToSentry: false }
  }

  // 54000 (program_limit_exceeded) — 019 guard (c2)'s 100 KB cap. Client
  // validation (95,000-byte margin) should have caught this already;
  // reaching the RPC means that check was bypassed — reported as unexpected.
  if (error.code === '54000') {
    return { kind: 'too-large', message: "That's too long to save.", reportToSentry: true }
  }

  // Unmapped — never render the raw Postgres message to a PM (design-
  // principles §2.6: no persona ever sees a raw error or an unexplained gap).
  return {
    kind: 'unknown',
    message: 'Something went wrong — please try again.',
    reportToSentry: true,
  }
}
