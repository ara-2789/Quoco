// §37(c) of design-decisions-beta-feedback.md — the owner-send routing
// decision, extracted as a pure function so the rule has exactly one place
// it's evaluated, not re-derived inline wherever the ownerSend handler
// (unbuilt) eventually needs it.
//
// THE RULE, STATED PRECISELY, per §37(c)'s own text: the gate is
// `evening_submitted_at IS NULL` — nothing else. NOT "no daily_logs row
// exists" (a row can exist from a morning-only day and still gate), and
// NOT "partial data" (a vaguer standard §37(c) explicitly rejected as
// ungoverned). A single `evening_submitted_at` value therefore fully
// captures the decision — a missing row and a present-but-null value are
// the same case (both read as `null` here), matching §37(c)'s own framing.
//
// SCOPE, NAMED SO IT ISN'T ASSUMED SETTLED: this function decides the
// route for ONE evening_submitted_at fact — one engineer, one project-day
// (matching what a single `daily_logs`/`dprs` row actually carries, per
// 028's per-engineer key widening). It does NOT decide how a caller
// AGGREGATES this across every engineer on a project to produce ONE
// owner-facing send for that project-day — 034's own review package §12a
// named that aggregation policy as a genuinely open, unbuilt question
// ("the no-report notice is sent ONCE per owner per project-day; dprs rows
// are per engineer... something must resolve which N before any UPDATE
// runs"). RESOLVED, 2026-09-02: `lib/dpr/owner-deliver-dispatch.ts` calls
// this function once per engineer and fans the notice-path outcome out to
// every 'notice'-routed row in one batch write, sending exactly one real
// WhatsApp/email notice per project-day. Full reasoning:
// docs/reviews/owner-deliver-handler-record.md, Decision 1.

export type OwnerDeliveryRoute = 'report' | 'notice'

/**
 * Takes: evening_submitted_at exactly as stored (an ISO timestamp string,
 * a Date, or null/undefined for "no evening submission recorded" —
 * whichever shape the caller already has on hand; all three collapse to
 * the same decision).
 *
 * Returns: 'report' when evening data exists (send the real DPR), 'notice'
 * when it does not (send the §37(d) no-report notice instead). Pure — no
 * IO, no clock read, no default applied silently; the caller supplies the
 * fact, this function only decides the branch.
 */
export function decideOwnerDeliveryRoute(eveningSubmittedAt: string | Date | null | undefined): OwnerDeliveryRoute {
  return eveningSubmittedAt === null || eveningSubmittedAt === undefined ? 'notice' : 'report'
}
