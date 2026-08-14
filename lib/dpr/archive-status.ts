import type { StatusVariant } from '@/components/ui/status-chip'

// DPR Archive row status (DASH-04 detail view PR) — mirrors the shape and
// intent of lib/daily-logs/status.ts's deriveHalfStatus: a pure function
// mapping real columns to one of the four semantic chip roles (docs/
// design-tokens.md §1), never a bare enum value shown to a PM.
//
// WHY THIS EXISTS: the list page used to filter `.not('content', 'is',
// null)`, so a failed or still-running generation rendered IDENTICALLY to a
// night nothing was attempted — the exact absence-vs-failure conflation this
// product exists to catch, reproduced in its own dashboard. Every dprs row
// for an eligible project now surfaces, with an honest state.
//
// PRIORITY ORDER MATTERS — checked top to bottom, first match wins:
//   1. content present wins outright, regardless of what generation_status/
//      delivery_status say. content is only ever written by the SAME upsert
//      that sets generation_status: 'idle' (lib/dpr/dispatch.ts's success
//      path), so its presence is the one unambiguous "this succeeded"
//      signal — trust it over the two status columns.
//   2. generation_status: 'running' — actively being computed right now.
//   3. delivery_status: 'failed' — retries exhausted (NFR-17,
//      markDprGenerationFailed). Only ever set once, never on an
//      intermediate retryable failure.
//   4. delivery_status: 'skipped_no_data' — DPR-17, the correct outcome for
//      a day nobody checked in. Blue/info, NEVER red — this is information
//      about the site, not a software failure (2026-07-18 refinement:
//      legitimate absences take blue, not amber; the same distinction
//      lib/daily-logs/status.ts already draws for holiday/messaging_blocked).
//   5. Everything else — a row exists, content is null, and none of the
//      above explains why. Amber/risk: an unexplained gap, same semantic
//      daily-logs/status.ts uses for "Not checked in" past cutoff.

export type DprArchiveState = 'generated' | 'generating' | 'failed' | 'no_data' | 'not_generated'

export type DprArchiveStatus = {
  state: DprArchiveState
  variant: StatusVariant
  label: string
}

export type DprArchiveRowInput = {
  content: string | null
  generation_status: string
  delivery_status: string
}

export function deriveDprArchiveStatus(row: DprArchiveRowInput): DprArchiveStatus {
  if (row.content !== null) {
    return { state: 'generated', variant: 'ok', label: 'Generated' }
  }
  if (row.generation_status === 'running') {
    return { state: 'generating', variant: 'muted', label: 'Generating' }
  }
  if (row.delivery_status === 'failed') {
    return { state: 'failed', variant: 'blocked', label: 'Generation failed' }
  }
  // DATED NOTE (2026-08-14, per-engineer report reformat, round-3 N3): no
  // NEW row can carry this status any longer — the project-level DPR-17
  // skip marker this value was for (app/api/cron/dpr-generate/route.ts's
  // old project-loop) is superseded by the roster/union trigger, which
  // never writes 'skipped_no_data' (S4: a zero-eligible-engineer project
  // now writes no row at all, detected via Sentry instead — see the cron
  // route). The one row that ever had this value (35a2f41c) is deleted by
  // migration 028 (Option A). Kept, not deleted: cheap, pure, and the
  // deferred project-level report may reintroduce a project-level skip
  // concept later, same "leave retained-but-unused logic in place" pattern
  // as the kept multi-row lib/dpr/assemble.ts functions.
  if (row.delivery_status === 'skipped_no_data') {
    return { state: 'no_data', variant: 'info', label: 'No site data submitted' }
  }
  return { state: 'not_generated', variant: 'risk', label: 'Not generated' }
}
