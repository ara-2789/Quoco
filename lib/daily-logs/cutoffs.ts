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
//
// FROZEN FOR MVP (2026-08-15, Aravind's decision, final). The full schedule
// below — not individually revisited per-checkpoint from here on; treat this
// object as the single point of change if it ever does move again. Two
// checkpoints that were previously independent are now the SAME MOMENT:
// `eveningClose` is both "an unsubmitted evening half closes as
// not_submitted" AND "DPR generation runs, evening closes, PM is notified" —
// Rule 7.2 closes a missing evening AT REPORT TIME, not on its own separate
// clock. There is no distinct "dprGenerate" checkpoint; `eveningClose` IS it.
// `ownerSend` is new — the automatic, unconditional 20:30 owner send
// (docs/dpr-engineer-report-spec.md's two-stage delivery design). vercel.json's
// `dpr-generate` cron schedule and its new owner-send cron are the literal
// clock encodings of `eveningClose`/`ownerSend` respectively — kept in sync by
// hand (cron syntax can't import a TS constant); if this object changes again,
// vercel.json must change with it in the same commit.

export const CHECKIN_CHECKPOINTS = {
  /** IST "HH:MM" — morning check-in trigger send (not yet automated; no cron exists). */
  morningSend: '08:30',
  /** IST "HH:MM" — morning nudge, if still unsubmitted. */
  morningNudge: '10:00',
  /** IST "HH:MM" — PM escalation surfaces on the DASH-01 dashboard (never a WhatsApp send); persistent until submit or morningCutoff. */
  morningEscalate: '10:30',
  /** IST "HH:MM" — morning cutoff: closes an unsubmitted half as not_submitted, no further nudging. */
  morningCutoff: '15:00',
  /** IST "HH:MM" — evening check-in trigger send (not yet automated; no cron exists). */
  eveningSend: '18:30',
  /** IST "HH:MM" — evening nudge, if still unsubmitted. Also DASH-03's evening "past cutoff" boundary. */
  eveningNudge: '19:15',
  /** IST "HH:MM" — evening close AND DPR generation AND PM notification, all one moment (see FROZEN FOR MVP note above) — closes an unsubmitted evening half as not_submitted at the same instant the report is generated and the PM is told to look at it. */
  eveningClose: '19:45',
  /** IST "HH:MM" — automatic, unconditional owner send. Never gated on a PM action — the PM's edit window (eveningClose -> ownerSend) is an opportunity, never a gate. */
  ownerSend: '20:30',
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
// missing evening half as a gap at the nudge checkpoint since it was built,
// and that predates (and is conceptually distinct from) the sweep's own close
// boundary added here — the board flags risk when the nudge fires (19:15);
// the sweep waits a further 30 minutes before finalizing the row, at the same
// moment DPR generation runs (19:45), per Rule 7.2's escalation path. Not
// collapsed into one value; kept as the two constants they are.
export const DEFAULT_CUTOFFS: CutoffConfig = {
  morning: CHECKIN_CHECKPOINTS.morningCutoff,
  evening: CHECKIN_CHECKPOINTS.eveningNudge,
}
