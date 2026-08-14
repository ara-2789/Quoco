// Target-status decision for the check-in escalation sweep. PURE — no
// Supabase, no IO. This is the whole state machine: given a half, the current
// time, and whether a submission exists, decide what status this row should
// be advanced to (or left alone).
//
// CORRECTION 1 (2026-08-13, Aravind's review): this slice writes NO 'nudged'
// status and NEVER sets nudge_sent_at. That column means "sent at" — writing
// it with no message ever sent is a false fact, not a harmless placeholder,
// regardless of whether status is read as "lifecycle stage reached" rather
// than "message delivered." So determineTargetStatus below only ever
// produces 'awaited' | 'escalated' | 'not_submitted' | 'submitted' — never
// 'nudged'. 'nudged' remains a valid CHECK-constrained value (a future
// sender slice writes it, with nudge_sent_at, honestly), and the rank table
// below still accounts for it as a possible EXISTING status this sweep must
// correctly advance FROM — just never a value this code assigns TO.
// A row may therefore jump awaited -> escalated directly while no sender
// exists yet; that is correct and self-repairs the moment a sender exists
// and starts filling the intermediate 'nudged' stage.
//
// DECISION 3 (2026-08-13): evening has NO escalation stage. Thirty minutes
// separate the evening nudge (19:30) from DPR generation (20:00) — Rule 7.2's
// terminal behaviour is already the DPR itself flagging an unresolved gap in
// the owner's report, so there is nothing for a dashboard escalation to add
// in that window. Evening's only transitions here are awaited -> not_submitted
// (at/after 20:00) and (at any time) -> submitted.
//
// Checkpoint times are imported from lib/daily-logs/cutoffs.ts's
// CHECKIN_CHECKPOINTS — the single source shared with the DASH-03 board's
// own cutoff, not re-declared here. Do not hardcode a time string in this
// file; that is precisely the drift cutoffs.ts's own header warns against.

import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { istParts } from '@/lib/daily-logs/status'

export type CheckinStatus = 'awaited' | 'nudged' | 'escalated' | 'not_submitted' | 'submitted'

export type Half = 'morning' | 'evening'

export interface StatusDecisionInput {
  half: Half
  /** Current instant (UTC Date, e.g. from a cron invocation) — converted to IST internally. */
  now: Date
  /** daily_logs.morning_submitted_at / evening_submitted_at for this engineer/date, or null. */
  submittedAt: string | null
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const MORNING_NUDGE = minutesOf(CHECKIN_CHECKPOINTS.morningNudge) // 09:00 — boundary only, this slice writes no status here
const MORNING_ESCALATE = minutesOf(CHECKIN_CHECKPOINTS.morningEscalate) // 10:00
const MORNING_CUTOFF = minutesOf(CHECKIN_CHECKPOINTS.morningCutoff) // 15:00
const EVENING_CLOSE = minutesOf(CHECKIN_CHECKPOINTS.eveningClose) // 20:00

// MORNING_NUDGE has no branch of its own below (this slice writes no status
// at that checkpoint) but is kept as a live guard, not a comment: if a future
// edit to cutoffs.ts ever reorders the checkpoints so nudge lands AFTER
// escalate, this throws at import time instead of silently producing a
// schedule where the sender's stage comes after the dashboard's.
if (MORNING_NUDGE >= MORNING_ESCALATE) {
  throw new Error('checkin-escalations/status: morningNudge must be before morningEscalate in cutoffs.ts')
}

/**
 * Pure decision: what status should this (engineer, half, date) row be
 * advanced to right now? Deliberately computed fresh from wall-clock time on
 * every call, not tied to any particular invocation cadence — the sweep
 * converges to the correct state whether it runs every minute or has missed
 * several checkpoints, rather than depending on catching each transition
 * exactly once.
 */
export function determineTargetStatus(input: StatusDecisionInput): CheckinStatus {
  if (input.submittedAt) return 'submitted'

  const { minutes } = istParts(input.now)

  if (input.half === 'morning') {
    // MORNING_NUDGE (09:00) is a real checkpoint in the schedule but this
    // slice writes no status there — 'nudged' belongs to the sender slice.
    // Before MORNING_ESCALATE, there is nothing for this slice to advance to.
    if (minutes < MORNING_ESCALATE) return 'awaited'
    if (minutes < MORNING_CUTOFF) return 'escalated'
    return 'not_submitted'
  }

  // evening — no escalation stage (Decision 3).
  if (minutes < EVENING_CLOSE) return 'awaited'
  return 'not_submitted'
}

// ---------------------------------------------------------------------------
// Regression guard. Rank is the row's position in the lifecycle; a write is
// only ever allowed to move a row to a STRICTLY HIGHER rank than its current
// one. 'submitted' is ranked highest of all — nothing can ever downgrade it,
// which is the one invariant named explicitly in the task. not_submitted (3)
// can still advance to submitted (4) — the late-submission case closed_at
// was designed for (see 027's own migration comments) — but never the
// reverse.

const STATUS_RANK: Record<CheckinStatus, number> = {
  awaited: 0,
  nudged: 1,
  escalated: 2,
  not_submitted: 3,
  submitted: 4,
}

/**
 * CORRECTION 2 (2026-08-13): STRICT less-than, not less-than-or-equal. The
 * target's own current status is deliberately EXCLUDED from its own allowed
 * sources — a repeat invocation with the same computed target must match
 * ZERO rows in the guarded UPDATE (sweep.ts), not re-write the same status
 * and walk its timestamp forward. A true no-op, not a same-value rewrite.
 */
export function allowedSourceStatuses(target: CheckinStatus): CheckinStatus[] {
  const targetRank = STATUS_RANK[target]
  return (Object.keys(STATUS_RANK) as CheckinStatus[]).filter((s) => STATUS_RANK[s] < targetRank)
}

/** Which column satisfies 027's CHECK constraint for a given target status. null for 'awaited' (no transition — set only by the initial insert's default) and 'nudged' (not written by this slice; a future sender sets nudge_sent_at itself). */
export function timestampColumnFor(target: CheckinStatus): 'escalated_at' | 'closed_at' | null {
  switch (target) {
    case 'escalated':
      return 'escalated_at'
    case 'not_submitted':
    case 'submitted':
      return 'closed_at'
    case 'awaited':
    case 'nudged':
      return null
  }
}
