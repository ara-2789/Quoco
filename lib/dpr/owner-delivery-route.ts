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
// owner-facing send for that project-day — that aggregation policy is a
// genuinely open, unbuilt question (034's own review package §12a names
// it explicitly: "the no-report notice is sent ONCE per owner per
// project-day; dprs rows are per engineer... something must resolve which
// N before any UPDATE runs"). Deciding an aggregation rule here would be
// answering a question this file was not asked to answer; a caller with a
// roster of engineers calls this once per engineer and combines the
// results under whatever policy gets decided when the owner-send handler
// is actually built.

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
