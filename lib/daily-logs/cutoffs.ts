// Check-in nudge/escalation checkpoints — the SINGLE SOURCE OF TRUTH for every
// clock-time boundary this project's check-in flow depends on. Both the DASH-03
// board's "past cutoff" boundary (CutoffConfig/DEFAULT_CUTOFFS below) and the
// checkin_escalations sweep's own checkpoints derive from this one object, so
// the two cannot drift apart the way this file's own original header warned
// they must not.
//
// Times are IST (Asia/Kolkata) wall-clock. Consumers MUST convert now() to IST
// before comparing — Vercel's now() is UTC (see lib/daily-logs/status.ts's
// istParts, or lib/checkin-escalations' reuse of it).
//
// DATED CORRECTION (2026-08-13): morning was '10:30', sourced from
// design-decisions-beta-feedback.md §3's "TBD from customer... roughly 10:30" —
// that figure was never finalized and has since been superseded. The recorded
// decision (docs/bot-flows.md TRIGGER TIMES, 2026-08-12) sets the morning
// cutoff at 15:00 — chosen specifically to clear the check-in queue before the
// evening cycle begins, not a customer-supplied number. This file was not
// updated when that decision landed, which is exactly the drift this file's
// own header comment warned against; corrected here, before the
// checkin_escalations sweep (the "future cutoff cron" this file anticipated)
// is built against it.

export const CHECKIN_CHECKPOINTS = {
  /** IST "HH:MM" — morning check-in trigger send (not yet automated; no cron exists). */
  morningSend: '07:30',
  /** IST "HH:MM" — morning nudge, if still unsubmitted. */
  morningNudge: '09:00',
  /** IST "HH:MM" — PM escalation surfaces on the DASH-01 dashboard (never a WhatsApp send). */
  morningEscalate: '10:00',
  /** IST "HH:MM" — morning cutoff: closes an unsubmitted half as not_submitted, no further nudging. */
  morningCutoff: '15:00',
  /** IST "HH:MM" — evening check-in trigger send (not yet automated; no cron exists). */
  eveningSend: '18:30',
  /** IST "HH:MM" — evening nudge, if still unsubmitted. Also DASH-03's evening "past cutoff" boundary. */
  eveningNudge: '19:30',
  /** IST "HH:MM" — evening close: closes an unsubmitted half as not_submitted, ahead of 20:00 DPR generation. */
  eveningClose: '20:00',
} as const

export type CutoffConfig = {
  /** IST wall-clock "HH:MM" after which a missing morning half is a gap. */
  morning: string
  /** IST wall-clock "HH:MM" after which a missing evening half is a gap. */
  evening: string
}

// DASH-03's board boundary. morning now equals the sweep's actual close time
// (morningCutoff) rather than an earlier, separate customer-TBD guess — the
// board and the sweep agree on when a morning half becomes a genuine gap.
// evening equals the nudge checkpoint, NOT eveningClose: DASH-03 has shown a
// missing evening half as a gap at 19:30 since it was built, and that predates
// (and is conceptually distinct from) the sweep's own 20:00 close boundary
// added here — the board flags risk when the nudge fires; the sweep waits a
// further 30 minutes before finalizing the row, per Rule 7.2's escalation
// path. Not collapsed into one value; kept as the two constants they are.
export const DEFAULT_CUTOFFS: CutoffConfig = {
  morning: CHECKIN_CHECKPOINTS.morningCutoff,
  evening: CHECKIN_CHECKPOINTS.eveningNudge,
}
