import { describe, it, expect } from 'vitest'
import type { WhatsAppSession } from '@/lib/whatsapp/session'
import {
  dispatchMorningFlow,
  MORNING_QUESTIONS,
  MORNING_COMPLETE_REPLY,
  MORNING_ALREADY_COMPLETE_REPLY,
  MORNING_IDLE_REPLY,
} from '@/lib/whatsapp/flows/morning'
import { parseLabourCount } from '@/lib/whatsapp/flows/parsers/labour'
import { parseEquipment } from '@/lib/whatsapp/flows/parsers/equipment'

// Pure unit tests for dispatchMorningFlow — the decision MIRROR of
// apply_morning_flow_turn (migrations 014 + 018). No DB: we construct session
// snapshots and assert on the returned object only. See the AUTHORITY NOTE in
// morning.ts — a green run here documents the decision intent but is NOT on its
// own proof of production correctness (the branch integration tests are).

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
  // 1. start — env-gated trigger on an idle session asks Q1, writes nothing.
  it('start: startFlow on an idle session asks Q1 and writes no daily_log', () => {
    const d = dispatchMorningFlow(makeSession(), 'ignored body', { startFlow: true })
    expect(d.outcome).toBe('start')
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
    expect(d.sessionUpdate.current_step).toBe(1)
    expect(d.sessionUpdate.context).toEqual({})
    expect(d.dailyLogWrite).toBeNull()
  })

  // 2. advance Q1 -> stores morning_plan, advances to Q2 (step 2, NOT 4).
  it('advance Q1: stores morning_plan and advances to step 2 / Q2', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, '  Pour slab on level 3  ')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ morning_plan: 'Pour slab on level 3' })
    expect(d.sessionUpdate.current_step).toBe(2)
    expect(d.reply).toBe(MORNING_QUESTIONS[2])
  })

  // 3. advance Q2 (parsed labour) -> stores morning_manpower_planned, to step 3.
  it('advance Q2: stores parsed manpower and advances to step 3 / Q3', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2 })
    const d = dispatchMorningFlow(session, '12 mason 8 helper')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_manpower_planned: parseLabourCount('12 mason 8 helper'),
    })
    expect(d.sessionUpdate.current_step).toBe(3)
    expect(d.sessionUpdate.context).toEqual({ q2_reask: 0 })
    expect(d.reply).toBe(MORNING_QUESTIONS[3])
  })

  // 4. Q2 unparseable (no number) -> reask ONCE, counter set, no write.
  it('Q2 no-number: reask, increments q2_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2 })
    const d = dispatchMorningFlow(session, 'some workers')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBe(2)
    expect(d.sessionUpdate.context).toEqual({ q2_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[2])
  })

  // 5. Q2 unparseable AGAIN after the budgeted reask -> accept raw, advance.
  it('Q2 no-number after one reask: accepts raw, advances, stores parse', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2, context: { q2_reask: 1 } })
    const d = dispatchMorningFlow(session, 'still no number')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_manpower_planned: parseLabourCount('still no number'),
    })
    expect(d.sessionUpdate.current_step).toBe(3)
    expect(d.sessionUpdate.context).toEqual({ q2_reask: 0 })
  })

  // 6. advance Q3 (parsed equipment) -> stores morning_equipment, to step 4.
  it('advance Q3: stores parsed equipment and advances to step 4 / Q4', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3 })
    const d = dispatchMorningFlow(session, 'JCB 1500')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ morning_equipment: parseEquipment('JCB 1500') })
    expect(d.sessionUpdate.current_step).toBe(4)
    expect(d.sessionUpdate.context).toEqual({ q3_reask: 0 })
    expect(d.reply).toBe(MORNING_QUESTIONS[4])
  })

  // 7. Q3 "no equipment" sentinel -> answered-empty, advances (NOT a reask).
  it('Q3 none sentinel: advances with none:true stored, not a reask', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3 })
    const d = dispatchMorningFlow(session, 'illa')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ morning_equipment: parseEquipment('illa') })
    expect(d.dailyLogWrite?.morning_equipment).toMatchObject({ none: true, items: [] })
    expect(d.sessionUpdate.current_step).toBe(4)
  })

  // 8. Q3 garbled -> reask once, counter set, no write.
  it('Q3 garbled: reask, increments q3_reask, step unchanged, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 3 })
    const d = dispatchMorningFlow(session, 'asdf')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.sessionUpdate.current_step).toBe(3)
    expect(d.sessionUpdate.context).toEqual({ q3_reask: 1 })
    expect(d.reply).toBe(MORNING_QUESTIONS[3])
  })

  // 9. advance Q4 -> completion: execution plan + submitted_at, marker set.
  it('advance Q4: stores execution plan + submitted_at, completes with marker', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 4 })
    const d = dispatchMorningFlow(session, 'Crew A then Crew B', { now: FIXED_NOW })
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({
      morning_execution_plan: 'Crew A then Crew B',
      morning_submitted_at: FIXED_NOW,
    })
    expect(d.sessionUpdate.current_step).toBe(0)
    expect(d.sessionUpdate.context).toEqual({ morning_submitted: true })
    expect(d.reply).toBe(MORNING_COMPLETE_REPLY)
  })

  // 10. already_complete — idle + marker, no startFlow: says so, no write.
  it('already_complete: idle session with the completion marker, no write', () => {
    const session = makeSession({ current_flow: null, context: { morning_submitted: true } })
    const d = dispatchMorningFlow(session, 'hello again')
    expect(d.outcome).toBe('already_complete')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_ALREADY_COMPLETE_REPLY)
  })

  // 11. idle — idle session, no marker, no startFlow: nothing to do, no reply.
  it('idle: idle session with no marker returns idle and an empty reply', () => {
    const d = dispatchMorningFlow(makeSession(), 'hello')
    expect(d.outcome).toBe('idle')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_IDLE_REPLY)
    expect(d.reply).toBe('')
  })

  // 12. reask — empty/whitespace answer to any active question: re-ask, no write,
  //     no budget consumed (counter untouched).
  it('reask: whitespace-only answer re-asks the current question, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 2 })
    const d = dispatchMorningFlow(session, '   ')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[2])
    expect(d.sessionUpdate.current_step).toBeUndefined()
  })

  // 13. start-while-active — startFlow but a morning flow is already active:
  //     do NOT restart, re-ask the current question.
  it('start while morning already active: reask, no restart', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'ignored', { startFlow: true })
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
  })

  // 14. non-morning flow active — scopes out to idle, no misfire.
  it('non-morning flow active: scopes out to idle, no write', () => {
    const session = makeSession({ current_flow: 'evening', current_step: 2 })
    const d = dispatchMorningFlow(session, 'some evening answer')
    expect(d.outcome).toBe('idle')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_IDLE_REPLY)
  })
})
