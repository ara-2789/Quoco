import type { CutoffConfig } from './cutoffs'

// Per-half status derivation for the Daily Logs view (DASH-03).
//
// Maps the real columns (design-principles §4 Rule 4.5, design-tokens §1 + the
// 2026-07-18 Amber-narrowing refinement) to one of the four semantic chip roles:
//
//   submitted (human signal)        -> ok      (green)   counts, on-track
//   is_holiday                      -> info    (blue)    EXCLUDED from accountability (Rule 5.3)
//   messaging_blocked               -> info    (blue)    EXCLUDED from accountability (Rule 5.3)
//   missing, before cutoff (today)  -> awaiting(muted)   not yet due — no gap
//   missing, after cutoff / past    -> risk    (amber)   a genuine open gap
//
// Red is deliberately unused here (Rule 4.5): absence has legitimate reasons.
// The holiday / messaging_blocked exclusion is a real branch, not label-only, so
// Rule 5.3's fairness distinction is visible at the chip level.

export type Half = 'morning' | 'evening'

export type HalfState = 'submitted' | 'holiday' | 'messaging_blocked' | 'awaiting' | 'missing'

export type StatusVariant = 'blocked' | 'risk' | 'ok' | 'info' | 'muted'

export type HalfStatus = {
  state: HalfState
  variant: StatusVariant
  label: string
  /** Whether this half counts toward accountability math (false for legitimate absences). */
  countsForAccountability: boolean
}

/** Minimal shape this function reads off a daily_logs row (or null when absent). */
export type LogHalfInput = {
  morning_submitted_at: string | null
  evening_submitted_at: string | null
  is_holiday: boolean | null
  holiday_reason: string | null
}

// IST (Asia/Kolkata) calendar-day + minutes-of-day for a UTC instant.
// Vercel's now() is UTC — comparing it bare against IST cutoffs would misclassify
// engineers around the cutoff hour. This is the explicit conversion.
function istParts(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  return { date, minutes }
}

function cutoffMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function deriveHalfStatus(
  log: LogHalfInput | null,
  messagingBlocked: boolean,
  half: Half,
  /** The card's date, as an IST calendar date "YYYY-MM-DD". */
  logDate: string,
  now: Date,
  cutoffs: CutoffConfig,
): HalfStatus {
  const submittedAt =
    log && (half === 'morning' ? log.morning_submitted_at : log.evening_submitted_at)

  // 1. Real human submission wins.
  if (submittedAt) {
    return {
      state: 'submitted',
      variant: 'ok',
      label: 'Submitted',
      countsForAccountability: true,
    }
  }

  // 2. Holiday — legitimate, excluded from accountability (Rule 5.3).
  if (log?.is_holiday) {
    const reason = log.holiday_reason?.trim()
    return {
      state: 'holiday',
      variant: 'info',
      label: reason ? `Site closed — ${reason}` : 'Site closed',
      countsForAccountability: false,
    }
  }

  const ist = istParts(now)

  // 3. Messaging blocked — legitimate, excluded; carries a PM unblock action.
  // DATED LIMITATION (2026-07-18, per DASH-03 review S1): `messagingBlocked` is
  // the engineer's CURRENT user-state, not a per-day fact. Applying it to a PAST
  // date would retroactively excuse a gap the engineer may well have been
  // reachable for — historical block-state is UNKNOWABLE until a block-history
  // mechanism exists. So this branch is scoped to TODAY only; past dates fall
  // through to the clock logic regardless of the current flag. Documented in
  // docs/design-decisions-beta-feedback.md §3.1. (Contrast is_holiday above,
  // which is stored ON the daily_logs row and so is historically accurate.)
  if (messagingBlocked && logDate === ist.date) {
    return {
      state: 'messaging_blocked',
      variant: 'info',
      label: 'Messaging blocked',
      countsForAccountability: false,
    }
  }

  // 4 vs 5 — missing. Only TODAY (in IST) can be "awaiting"; any past date's
  // cutoff has definitively passed, so a blank half is a gap without consulting
  // the clock.
  const cutoff = cutoffMinutes(half === 'morning' ? cutoffs.morning : cutoffs.evening)

  if (logDate < ist.date) {
    return {
      state: 'missing',
      variant: 'risk',
      label: 'Not checked in',
      countsForAccountability: true,
    }
  }
  if (logDate > ist.date || ist.minutes < cutoff) {
    // Future date, or today before cutoff — not yet due.
    return {
      state: 'awaiting',
      variant: 'muted',
      label: half === 'morning' ? 'Awaiting morning' : 'Awaiting evening',
      countsForAccountability: false,
    }
  }
  // Today, after cutoff.
  return {
    state: 'missing',
    variant: 'risk',
    label: 'Not checked in',
    countsForAccountability: true,
  }
}
