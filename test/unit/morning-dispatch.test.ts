import { describe, it, expect } from 'vitest'
import type { WhatsAppSession } from '@/lib/whatsapp/session'
import {
  dispatchMorningFlow,
  MORNING_QUESTIONS,
  MORNING_COMPLETE_REPLY,
  MORNING_ALREADY_COMPLETE_REPLY,
  MORNING_IDLE_REPLY,
} from '@/lib/whatsapp/flows/morning'

// Pure unit tests for dispatchMorningFlow — the decision MIRROR of
// apply_morning_flow_turn (migration 014). No DB: we construct session
// snapshots and assert on the returned object only. See the AUTHORITY NOTE in
// morning.ts — a green run here documents the decision intent but is NOT on its
// own proof of production correctness (the branch integration tests are).

const FIXED_NOW = '2026-03-16T06:30:00.000Z'

// Minimal WhatsAppSession builder; override only what a case cares about.
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

  // 2. advance (Q1) — answer stored to morning_plan, flow advances to Q4.
  it('advance Q1: stores morning_plan and advances to step 4 / Q4', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, '  Pour slab on level 3  ')
    expect(d.outcome).toBe('advance')
    expect(d.dailyLogWrite).toEqual({ morning_plan: 'Pour slab on level 3' })
    expect(d.sessionUpdate.current_step).toBe(4)
    expect(d.reply).toBe(MORNING_QUESTIONS[4])
  })

  // 3. advance (Q4) — completion: execution plan + submitted_at, marker set.
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

  // 4. already_complete — idle + marker, no startFlow: says so, no write.
  it('already_complete: idle session with the completion marker, no write', () => {
    const session = makeSession({ current_flow: null, context: { morning_submitted: true } })
    const d = dispatchMorningFlow(session, 'hello again')
    expect(d.outcome).toBe('already_complete')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_ALREADY_COMPLETE_REPLY)
  })

  // 5. idle — idle session, no marker, no startFlow: nothing to do, no reply.
  it('idle: idle session with no marker returns idle and an empty reply', () => {
    const d = dispatchMorningFlow(makeSession(), 'hello')
    expect(d.outcome).toBe('idle')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_IDLE_REPLY)
    expect(d.reply).toBe('')
  })

  // 6. reask — empty/whitespace answer to the active question: re-ask, no write.
  it('reask: whitespace-only answer re-asks the current question, no write', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, '   ')
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
    expect(d.sessionUpdate.current_step).toBeUndefined()
  })

  // 7. start-while-active — startFlow but a morning flow is already active:
  //    do NOT restart, re-ask the current question.
  it('start while morning already active: reask, no restart', () => {
    const session = makeSession({ current_flow: 'morning', current_step: 1 })
    const d = dispatchMorningFlow(session, 'ignored', { startFlow: true })
    expect(d.outcome).toBe('reask')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_QUESTIONS[1])
  })

  // 8. non-morning flow active — the final else branch (SQL + TS mirror). A flow
  //    that is neither 'morning' nor null must NOT misfire: this function scopes
  //    itself to the morning flow only.
  it('non-morning flow active: scopes out to idle, no write', () => {
    const session = makeSession({ current_flow: 'evening', current_step: 2 })
    const d = dispatchMorningFlow(session, 'some evening answer')
    expect(d.outcome).toBe('idle')
    expect(d.dailyLogWrite).toBeNull()
    expect(d.reply).toBe(MORNING_IDLE_REPLY)
  })
})
