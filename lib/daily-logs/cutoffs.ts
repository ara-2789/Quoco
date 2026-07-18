// Check-in finalization cutoffs — the clock-times after which an unsubmitted
// half is treated as a genuine gap (design-decisions-beta-feedback.md §3).
//
// TBD FROM CUSTOMER — NOT FINALIZED. Roughly 10:30 morning / 19:30 evening.
// This module is the SINGLE SOURCE OF TRUTH for these times. The future cutoff
// cron (migration 012-era, which stamps morning_finalized_at/evening_finalized_at)
// MUST import these same constants rather than re-declaring them, so the
// dashboard's "past cutoff" boundary and the cron's finalization boundary cannot
// drift apart. When the customer locks the number, change it here only.
//
// Times are IST (Asia/Kolkata) wall-clock. Consumers MUST convert now() to IST
// before comparing — Vercel's now() is UTC (see lib/daily-logs/status.ts).

export type CutoffConfig = {
  /** IST wall-clock "HH:MM" after which a missing morning half is a gap. */
  morning: string
  /** IST wall-clock "HH:MM" after which a missing evening half is a gap. */
  evening: string
}

export const DEFAULT_CUTOFFS: CutoffConfig = {
  morning: '10:30',
  evening: '19:30',
}
