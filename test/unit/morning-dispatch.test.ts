import { describe, it, expect } from 'vitest'
import type { WhatsAppSession } from '@/lib/whatsapp/session'
import {
  dispatchMorningFlow,
  MORNING_QUESTIONS,
  MORNING_COMPLETE_REPLY,
  MORNING_ALREADY_COMPLETE_REPLY,
  MORNING_IDLE_REPLY,
  MORNING_WRONG_FLOW_REPLY,
  MORNING_SITE_HOLIDAY_REPLY,
  MORNING_ABSENT_REPLY,
} from '@/lib/whatsapp/flows/morning'
import { parseEquipment } from '@/lib/whatsapp/flows/parsers/equipment'

// Pure unit tests for dispatchMorningFlow — the decision MIRROR of
// apply_morning_flow_turn. RENUMBERED by the morning flow migration
// (supabase/migrations/030_morning_flow_attendance.sql) — see
// docs/reviews/morning-flow-migration-review-package.md's step-mapping table
// (§2). No DB: we construct session snapshots and assert on the returned
// object only. See the AUTHORITY NOTE in morning.ts — a green run here
// documents the decision intent but is NOT on its own proof of production
// correctness (the branch integration tests, test/morning-flow.test.ts, are).

const FIXED_NOW = '2026-03-16T06:30:00.000Z'

function makeSession(overrides: Partial<WhatsAppSession> = {}): WhatsAppSession {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    created_at: FIXED_NOW,
    tenant_id: '00000000-0000-4000-a000-00000000d013',
    user_id: '00000000-0000-4000-a000-00000000e014',
    phone_number: '+19995550200',
    current_flow: null,
    current_step: 0,
    context: {},
    pending_flows: [],
    expires_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  }
}

describe('dispatchMorningFlow (pure decision mirror)', () => {
  // 1. start — env-gated trigger on an idle session asks Q1 (attendance), writes nothing.
  it('start: startFlow on an idle session asks Q1 and writes no daily_log', () => {
    const d = dispatchMorningFlow(makeSession(), 'ignored body', { startFlow: true })
    expect(d.outcome).toBe('start')
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
    expect(d.sessionUpdate.current_step).toBe(1)
    expect(d.sessionUpdate.context).toEqual({})
    expect(d.dailyLogWrite).toBeNull()
  })

  // 1b. start STRIPS morning's own reask keys, never a bare replace (closes
  //     the pre-existing morning.ts:188 TS/SQL divergence, CLAUDE.md's
  //     tracked entry opened 2026-08-19) — an unrelated key (e.g. an
  //     evening counter, or a stale morning_submitted from a completed day
  //     this restart is superseding) must survive.
  it('start: STRIPS q1/q3/q4/q5 reask keys but preserves unrelated context keys', () => {
    const session = makeSession({
      current_flow: null,
      context: { q1_reask: 1, q3_reask: 1, q4_reask: 1, q5_reask: 1, evening_submitted: true, some_other_key: 'x' },
    })
    const d = dispatchMorningFlow(session, 'ignored body', { startFlow: true })
    expect(d.outcome).toBe('start')
    expect(d.sessionUpdate.context).toEqual({ evening_submitted: true, some_other_key: 'x' })
  })

  // 2. advance Q1 YES -> attendance=present, advances to step 2 / Q2.
  it('advance Q1 yes: writes attendance=present and advances to step 2 / Q2', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'yes')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ attendance: 'present' })
    expect(d.sessionUpdate.current_step).toBe(2)
    expect(d.sessionUpdate.context).toEqual({ q1_reask: 0 })
    expect(d.reply).toBe(MORNING_QUESTIONS[2])
  })

  // 3. Q1 NO -> holiday follow-up (step 5), no write yet.
  it('advance Q1 no: advances to step 5 (holiday follow-up), no write yet', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'no')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBe(5)
    expect(d.sessionUpdate.context).toEqual({ q1_reask: 0 })
    expect(d.reply).toBe(MORNING_QUESTIONS[5])
  })

  // 4. Q1 unclassifiable -> reask once via q1_reask, step unchanged, no write.
  it('Q1 unclassifiable: reask, increments q1_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'maybe idk')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBeUndefined()
    expect(d.sessionUpdate.context).toEqual({ q1_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
  })

  // 5. Q1 unclassifiable AGAIN after the budgeted reask -> exhausted-reask
  //    default is YES (DECIDED 2026-08-23, review package §2 — the OPPOSITE
  //    direction from the holiday follow-up's own default, see test below):
  //    default-YES-when-actually-absent leaves 3 questions unanswered
  //    (visible, B3-recoverable); default-NO-when-actually-present would
  //    silently drop them all.
  it('Q1 unclassifiable after one reask: defaults to YES, writes attendance=present, advances', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1, context: { q1_reask: 1 } })
    const d = dispatchMorningFlow(session, 'still unclear')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ attendance: 'present' })
    expect(d.sessionUpdate.current_step).toBe(2)
    expect(d.sessionUpdate.context).toEqual({ q1_reask: 0 })
  })

  // 6. Holiday follow-up YES -> site_holiday, is_holiday=true, completes.
  it('holiday follow-up yes: attendance=site_holiday, is_holiday=true, completes', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 5 })
    const d = dispatchMorningFlow(session, 'yes', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      attendance: 'site_holiday',
      is_holiday: true,
      morning_submitted_at: FIXED_NOW,
    })
    expect(d.sessionUpdate.current_step).toBe(0)
    expect(d.sessionUpdate.context).toEqual({ morning_submitted: true })
    expect(d.reply).toBe(MORNING_SITE_HOLIDAY_REPLY)
  })

  // 7. Holiday follow-up NO -> absent, completes.
  it('holiday follow-up no: attendance=absent, completes', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 5 })
    const d = dispatchMorningFlow(session, 'no', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      attendance: 'absent',
      is_holiday: false,
      morning_submitted_at: FIXED_NOW,
    })
    expect(d.sessionUpdate.current_step).toBe(0)
    expect(d.reply).toBe(MORNING_ABSENT_REPLY)
  })

  // 8. Holiday follow-up unclassifiable -> reask once via q5_reask.
  it('holiday follow-up unclassifiable: reask, increments q5_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 5 })
    const d = dispatchMorningFlow(session, 'dunno')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.context).toEqual({ q5_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[5])
  })

  // 9. Holiday follow-up unclassifiable AGAIN -> exhausted-reask default
  //    stays `absent` (unchanged direction from the first draft — already
  //    correct: `absent` keeps the evening trigger and PM handoff alive,
  //    `site_holiday` would silently cancel both).
  it('holiday follow-up unclassifiable after one reask: defaults to absent, completes', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 5, context: { q5_reask: 1 } })
    const d = dispatchMorningFlow(session, 'still dunno', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      attendance: 'absent',
      is_holiday: false,
      morning_submitted_at: FIXED_NOW,
    })
    expect(d.sessionUpdate.current_step).toBe(0)
  })

  // 10. advance Q2 (free text) -> stores morning_plan, advances to step 3 / Q3.
  //     Old step 1's logic, moved here verbatim — no reask key involved.
  it('advance Q2: stores morning_plan and advances to step 3 / Q3', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2 })
    const d = dispatchMorningFlow(session, '  Pour slab on level 3  ')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ morning_plan: 'Pour slab on level 3' })
    expect(d.sessionUpdate.current_step).toBe(3)
    expect(d.reply).toBe(MORNING_QUESTIONS[3])
  })

  // 11. advance Q3 (parsed labour) -> stores morning_manpower (RESHAPED
  //     total/count, not the parser's own planned_total/planned_count — see
  //     030_morning_flow_attendance.sql's file header for why the rename
  //     stops at this write boundary), to step 4.
  it('advance Q3: stores reshaped manpower (total/count) and advances to step 4 / Q4', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3 })
    const d = dispatchMorningFlow(session, '12 mason 8 helper')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_manpower: {
        total: 20,
        by_trade: [
          { trade: 'mason', count: 12 },
          { trade: 'helper', count: 8 },
        ],
        raw_text: '12 mason 8 helper',
      },
    })
    expect(d.sessionUpdate.current_step).toBe(4)
    expect(d.sessionUpdate.context).toEqual({ q3_reask: 0 })
    expect(d.reply).toBe(MORNING_QUESTIONS[4])
  })

  // 12. Q3 unparseable (no number) -> reask ONCE via q3_reask (renamed from
  //     q2_reask), counter set, no write.
  it('Q3 no-number: reask, increments q3_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3 })
    const d = dispatchMorningFlow(session, 'some workers')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBe(3)
    expect(d.sessionUpdate.context).toEqual({ q3_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[3])
  })

  // 13. Q3 unparseable AGAIN after the budgeted reask -> accept raw, advance.
  it('Q3 no-number after one reask: accepts raw, advances, stores reshaped parse', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3, context: { q3_reask: 1 } })
    const d = dispatchMorningFlow(session, 'still no number')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_manpower: { total: null, by_trade: [], raw_text: 'still no number' },
    })
    expect(d.sessionUpdate.current_step).toBe(4)
    expect(d.sessionUpdate.context).toEqual({ q3_reask: 0 })
  })

  // 14. advance Q4 (parsed equipment) -> equipment is now the LAST question —
  //     stores morning_equipment + submitted_at, COMPLETES directly (not "to
  //     step 5" — step 5 is the holiday follow-up, a different branch).
  it('advance Q4: stores equipment + submitted_at, completes with marker', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 4 })
    const d = dispatchMorningFlow(session, 'JCB 1500', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_equipment: parseEquipment('JCB 1500'),
      morning_submitted_at: FIXED_NOW,
    })
    expect(d.sessionUpdate.current_step).toBe(0)
    expect(d.sessionUpdate.context).toEqual({ morning_submitted: true })
    expect(d.reply).toBe(MORNING_COMPLETE_REPLY)
  })

  // 14b. Q4 completion MERGES context, never replaces (022 fix, reviewer B2,
  //      unchanged principle — now the completing step is equipment, not
  //      execution plan). If evening already completed earlier the same
  //      day, morning completing afterwards must NOT wipe evening_submitted.
  //      Proves EVERY morning reask key (q1/q3/q4/q5) is stripped while an
  //      unrelated key survives untouched.
  it('advance Q4: MERGES context — evening_submitted and unrelated keys survive, all own counters stripped', () => {
    const session = makeSession({
      current_flow: 'morning',
      current_step: 4,
      context: {
        evening_submitted: true,
        q1_reask: 0,
        q3_reask: 1,
        q4_reask: 0,
        q5_reask: 0,
        some_other_key: 'x',
      },
    })
    const d = dispatchMorningFlow(session, 'JCB 1500', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.sessionUpdate.context).toEqual({
      evening_submitted: true,
      some_other_key: 'x',
      morning_submitted: true,
    })
  })

  // 15. Q4 "no equipment" sentinel -> answered-empty, COMPLETES (not merely
  //     advances — equipment is the last question now).
  it('Q4 none sentinel: completes with none:true stored, not a reask', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 4 })
    const d = dispatchMorningFlow(session, 'illa', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite?.morning_equipment).toMatchObject({ none: true, items: [] })
    expect(d.dailyLogWrite?.morning_submitted_at).toBe(FIXED_NOW)
    expect(d.sessionUpdate.current_step).toBe(0)
  })

  // 16. Q4 garbled -> reask once via q4_reask (renamed from q3_reask),
  //     counter set, no write.
  it('Q4 garbled: reask, increments q4_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 4 })
    const d = dispatchMorningFlow(session, 'asdf')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBeUndefined()
    expect(d.sessionUpdate.context).toEqual({ q4_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[4])
  })

  // 17. already_complete — idle + marker, no startFlow: says so, no write.
  it('already_complete: idle session with the completion marker, no write', () => {
    const session = makeSession({ current_flow: null, context: { morning_submitted: true } })
    const d = dispatchMorningFlow(session, 'hello again')
    expect(d.outcome).toBe('already_complete')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_ALREADY_COMPLETE_REPLY)
  })

  // 18. idle — idle session, no marker, no startFlow: nothing to do, no reply.
  it('idle: idle session with no marker returns idle and an empty reply', () => {
    const d = dispatchMorningFlow(makeSession(), 'hello')
    expect(d.outcome).toBe('idle')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_IDLE_REPLY)
    expect(d.reply).toBe('')
  })

  // 19. reask — empty/whitespace answer to any active question: re-ask, no
  //     write, no budget consumed. Step 2 is free text with no reask key, so
  //     sessionUpdate is empty (no context to merge either).
  it('reask: whitespace-only answer re-asks the current question, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2 })
    const d = dispatchMorningFlow(session, '   ')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[2])
    expect(d.sessionUpdate.current_step).toBeUndefined()
  })

  // 20. start-while-active — startFlow but a morning flow is already active:
  //     do NOT restart, re-ask the current question.
  it('start while morning already active: reask, no restart', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'ignored', { startFlow: true })
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
  })

  // 21. non-morning flow active — 022 fix: reports wrong_flow, not idle, so the
  //     webhook can retry against the correct RPC instead of silently
  //     swallowing the turn (the SID is already consumed by that point).
  it('non-morning flow active: reports wrong_flow, not idle, no write', () => {
    const session = makeSession({ current_flow: 'evening', current_step: 2 })
    const d = dispatchMorningFlow(session, 'some evening answer')
    expect(d.outcome).toBe('wrong_flow')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_WRONG_FLOW_REPLY)
  })
})
