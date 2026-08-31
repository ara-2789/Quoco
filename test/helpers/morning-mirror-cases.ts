// ONE fixture table drives BOTH the SQL half (apply_morning_flow_turn, via
// test-db) and the TS half (dispatchMorningFlow, the pure mirror) — a case
// added to only one is impossible by construction, since there is only one
// array to add it to. Same pattern as
// test/productivity-reconciliation-mirror.test.ts, extended to morning's
// renumbered flow (supabase/migrations/030_morning_flow_attendance.sql).
// Both halves are checked against the SAME `expected` value per case, not
// against each other directly — agreement is implied by both matching the
// one shared expectation, exactly as the evening mirror test already does.
//
// Covers every distinct BRANCH in the step-mapping table
// (docs/reviews/morning-flow-migration-review-package.md §2), not every
// edge case — the two dedicated suites (test/morning-flow.test.ts,
// test/unit/morning-dispatch.test.ts) already exhaust edge cases on each
// side individually. This table's job is agreement, not coverage.

export interface MorningMirrorCase {
  name: string
  /** Session state BEFORE this turn. */
  seedStep: number
  seedContext: Record<string, unknown>
  message: string
  expected: {
    outcome: 'start' | 'advance' | 'already_complete' | 'idle' | 'reask' | 'wrong_flow'
    nextStep: number
    attendance: 'present' | 'absent' | 'site_holiday' | null
  }
}

export const MORNING_MIRROR_CASES: readonly MorningMirrorCase[] = [
  {
    name: 'Q1 yes -> attendance=present, advances to step 2',
    seedStep: 1,
    seedContext: {},
    message: 'yes',
    expected: { outcome: 'advance', nextStep: 2, attendance: 'present' },
  },
  {
    name: 'Q1 no -> advances to step 5 (holiday follow-up), no write',
    seedStep: 1,
    seedContext: {},
    message: 'no',
    expected: { outcome: 'advance', nextStep: 5, attendance: null },
  },
  {
    name: 'Q1 unclassifiable -> reask, step unchanged',
    seedStep: 1,
    seedContext: {},
    message: 'maybe idk',
    expected: { outcome: 'reask', nextStep: 1, attendance: null },
  },
  {
    name: 'Q1 unclassifiable, budget exhausted -> DEFAULTS TO YES (DECIDED 2026-08-23)',
    seedStep: 1,
    seedContext: { q1_reask: 1 },
    message: 'still unclear',
    expected: { outcome: 'advance', nextStep: 2, attendance: 'present' },
  },
  {
    name: 'Holiday follow-up yes -> attendance=site_holiday, completes',
    seedStep: 5,
    seedContext: {},
    message: 'yes',
    expected: { outcome: 'advance', nextStep: 0, attendance: 'site_holiday' },
  },
  {
    name: 'Holiday follow-up no -> attendance=absent, completes',
    seedStep: 5,
    seedContext: {},
    message: 'no',
    expected: { outcome: 'advance', nextStep: 0, attendance: 'absent' },
  },
  {
    name: 'Holiday follow-up unclassifiable, budget exhausted -> DEFAULTS TO absent (unchanged direction)',
    seedStep: 5,
    seedContext: { q5_reask: 1 },
    message: 'still dunno',
    expected: { outcome: 'advance', nextStep: 0, attendance: 'absent' },
  },
  {
    name: 'Q2 (plan, free text) -> advances to step 3',
    seedStep: 2,
    seedContext: {},
    message: 'Pour slab on level 3',
    expected: { outcome: 'advance', nextStep: 3, attendance: null },
  },
  {
    name: 'Q3 (parsed labour) -> advances to step 4',
    seedStep: 3,
    seedContext: {},
    message: '12 mason 8 helper',
    expected: { outcome: 'advance', nextStep: 4, attendance: null },
  },
  {
    name: 'Q4 (parsed equipment) -> completes directly (not step 5)',
    seedStep: 4,
    seedContext: {},
    message: 'JCB 1500',
    expected: { outcome: 'advance', nextStep: 0, attendance: null },
  },
] as const
