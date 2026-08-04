import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyEveningFlowTurn,
  applyMorningFlowTurn,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  readSession,
  testPhone,
} from './helpers/db'

// Integration tests for migration 022 (apply_evening_flow_turn, and its
// one-line change to apply_morning_flow_turn's ELSE branch). Run ONLY against
// the test-db branch — the allowlist globalSetup guard hard-aborts otherwise.
// Reuses the shared tenant/engineer/project fixtures (ensureMorningFixtures) —
// their shape is generic (tenant + engineer + project + membership), nothing
// morning-specific about it; both flows write to the same daily_logs row,
// keyed by (project_id, engineer_id, log_date), not by phone.
//
// This mirrors the manual R5 rehearsal proof (docs/reviews/022-review-package.md)
// as committed, repeatable coverage: both Q2 conditional edges, the completion
// timing guard, context-merge in both directions, already_complete
// idempotency, and wrong_flow in both directions (including the direct proof
// that 022's one-line morning edit is live, not 018's original 'idle' body).

const P_NOW = '2026-04-10T19:00:00+05:30' // 19:00 IST, 10 Apr — evening check-in time
const P_LATER_SAME_DAY = '2026-04-10T19:30:00+05:30' // same IST day
const LOG_DATE = '2026-04-10'

// Drive a full morning flow to completion (Q1 -> Q2 -> Q3 -> Q4), so
// context-merge tests can start from a genuine post-morning state rather than
// an empty session.
async function completeMorning(phone: string, now: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now })
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: 'JCB 1500', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: 'Crew A then Crew B', startFlow: false, now })
}

beforeAll(async () => {
  await ensureMorningFixtures()
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('apply_evening_flow_turn (evening flow, Pass 1) + morning wrong_flow mirror', () => {
  // 1. start — asks Q1, writes NO daily_log yet.
  it('T-022-01: start — asks Q1, no daily_logs row materialised yet', async () => {
    const phone = testPhone('401')
    const r = await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    expect(r.outcome).toBe('start')
    expect(r.current_flow).toBe('evening')
    expect(r.current_step).toBe(1)
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  // 2. Q1 -> evening_output + quantities enrichment written, advances to Q2.
  it('T-022-02: Q1 — writes evening_output + quantities enrichment, advances to Q2', async () => {
    const phone = testPhone('402')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    const r = await applyEveningFlowTurn({
      phone,
      message: 'slab concrete 120 sqm, plastering 300 sft',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(2)
    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_output).toBe('slab concrete 120 sqm, plastering 300 sft')
    expect(log?.evening_output_quantities).toMatchObject({
      items: [
        { activity: 'slab concrete', quantity: 120, unit: 'sqm' },
        { activity: 'plastering', quantity: 300, unit: 'sqft' },
      ],
    })
    expect(log?.evening_schedule_met).toBeNull()
  })

  // 3. Q2 = "no" — THE CONDITIONAL EDGE: advances to Q3 (step 3), does NOT
  //    complete. Also the completion-timing guard's first half: submitted_at
  //    must stay null on this turn (022's CASE WHEN v_complete).
  it('T-022-03: Q2="no" — the conditional edge: advances to Q3, does not complete', async () => {
    const phone = testPhone('403')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: 'no', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBe('evening')
    expect(r.current_step).toBe(3)
    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_schedule_met).toBe(false)
    expect(log?.evening_schedule_miss_reason).toBeNull()
    expect(log?.evening_submitted_at).toBeNull()
  })

  // 4. Q3 (miss reason) — completes: writes the reason + submitted_at, session
  //    resets with the marker MERGED. Completion-timing guard's second half:
  //    submitted_at is set on THIS turn, one turn after Q2 resolved.
  it('T-022-04: Q3 (miss reason) — completes: writes reason + submitted_at, session resets', async () => {
    const phone = testPhone('404')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'no', startFlow: false, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: 'RMC truck delayed', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBeNull()
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_schedule_miss_reason).toBe('RMC truck delayed')
    expect(log?.evening_submitted_at).not.toBeNull()

    const session = await readSession(phone)
    expect(session?.current_flow).toBeNull()
    expect(session?.context).toEqual({ evening_submitted: true })
  })

  // 5. Q2 = "yes" — THE OTHER CONDITIONAL EDGE: completes AT STEP 2, Q3
  //    skipped entirely. Completion-timing guard, opposite direction:
  //    submitted_at is set on the SAME turn that resolves Q2.
  it('T-022-05: Q2="yes" — the other conditional edge: completes at step 2, Q3 skipped', async () => {
    const phone = testPhone('405')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBeNull()
    expect(r.current_step).toBe(0) // NOT 3 — the skip proof

    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_schedule_met).toBe(true)
    expect(log?.evening_schedule_miss_reason).toBeNull() // Q3 never asked
    expect(log?.evening_submitted_at).not.toBeNull() // same turn, contrast T-022-03/04

    const session = await readSession(phone)
    expect(session?.context).toEqual({ evening_submitted: true })
  })

  // 6. already_complete — a further inbound after completion writes nothing;
  //    the timestamp from the completing turn is frozen.
  it('T-022-06: already_complete — post-completion inbound writes nothing, timestamp frozen', async () => {
    const phone = testPhone('406')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    const submittedBefore = (await getDailyLog(LOG_DATE))?.evening_submitted_at

    const r = await applyEveningFlowTurn({ phone, message: 'thanks', startFlow: false, now: P_LATER_SAME_DAY })
    expect(r.outcome).toBe('already_complete')
    expect((await getDailyLog(LOG_DATE))?.evening_submitted_at).toBe(submittedBefore)
  })

  // 7. context-merge, direction A (on START) — morning_submitted survives
  //    evening's own start; only evening's own counter is cleared.
  it('T-022-07: context-merge on start — morning_submitted survives evening starting', async () => {
    const phone = testPhone('407')
    await completeMorning(phone, P_NOW)
    expect((await readSession(phone))?.context).toEqual({ morning_submitted: true })

    const r = await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    expect(r.outcome).toBe('start')
    expect(r.current_flow).toBe('evening')
    expect((await readSession(phone))?.context).toEqual({ morning_submitted: true })
  })

  // 8. context-merge, direction B (on COMPLETE) — both markers coexist once
  //    morning AND evening have each completed on the same session/day.
  it('T-022-08: context-merge on complete — both markers coexist after morning AND evening complete', async () => {
    const phone = testPhone('408')
    await completeMorning(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    const session = await readSession(phone)
    expect(session?.context).toEqual({ morning_submitted: true, evening_submitted: true })

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_submitted_at).not.toBeNull()
    expect(log?.evening_submitted_at).not.toBeNull()
  })

  // 9. wrong_flow — evening RPC called while morning is active. Morning's
  //    state must be completely unchanged, no evening_* column written, and
  //    morning must remain resumable exactly where it was.
  it('T-022-09: wrong_flow — evening RPC during an active morning flow leaves morning untouched and resumable', async () => {
    const phone = testPhone('409')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'site closing now', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('wrong_flow')
    expect(r.current_flow).toBe('morning')
    expect(r.current_step).toBe(2)

    const session = await readSession(phone)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(2)
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    expect(log?.evening_output).toBeNull()

    const resume = await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW })
    expect(resume.outcome).toBe('advance')
    expect(resume.current_step).toBe(3)
  })

  // 10. wrong_flow MIRROR — the direct proof that 022's one-line edit to
  //     apply_morning_flow_turn's ELSE branch is live: it must return
  //     'wrong_flow', NOT 018's original 'idle', when called during an
  //     active evening flow. Evening's state must be completely unchanged.
  it('T-022-10: wrong_flow mirror — morning RPC during an active evening flow returns wrong_flow, not idle', async () => {
    const phone = testPhone('410')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })

    const r = await applyMorningFlowTurn({ phone, message: 'plan for tomorrow', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('wrong_flow') // 018's body would return 'idle' here
    expect(r.current_flow).toBe('evening')
    expect(r.current_step).toBe(1)

    const session = await readSession(phone)
    expect(session?.current_flow).toBe('evening')
    expect(session?.current_step).toBe(1)
    // Neither evening's start (T-022-01) nor a wrong_flow turn writes
    // daily_logs — no row should exist at all yet.
    expect(await getDailyLog(LOG_DATE)).toBeNull()

    const resume = await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    expect(resume.outcome).toBe('advance')
    expect(resume.current_step).toBe(2)
  })

  // 11. empty re-ask — whitespace answer re-asks, no write, no budget spent.
  it('T-022-11: reask — whitespace-only answer re-asks, no write', async () => {
    const phone = testPhone('411')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: '   ', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('reask')
    expect(r.current_step).toBe(1)
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  // 12. RPC-level startFlow:false on an idle session -> idle, no write.
  it('T-022-12: idle — startFlow:false on an idle session -> idle, no write', async () => {
    const phone = testPhone('412')
    const r = await applyEveningFlowTurn({ phone, message: 'hi bot', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('idle')
    expect(r.current_flow).toBeNull()
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  // 13. context-merge, REVERSE direction (reviewer B2). T-022-08 proved
  //     morning -> evening; this proves evening -> morning. Before the fix,
  //     morning's Q4 completion did a bare context REPLACE, which would have
  //     silently wiped evening_submitted here — the bug is born in 022 (018
  //     never had a second flow to collide with), not inherited from it.
  it('T-022-13: context-merge REVERSE — evening completes first, then morning; both markers coexist', async () => {
    const phone = testPhone('413')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'some work done', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect((await readSession(phone))?.context).toEqual({ evening_submitted: true })

    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'JCB 1500', startFlow: false, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Crew A then Crew B', startFlow: false, now: P_NOW })

    const session = await readSession(phone)
    expect(session?.context).toEqual({ evening_submitted: true, morning_submitted: true })

    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_submitted_at).not.toBeNull()
    expect(log?.morning_submitted_at).not.toBeNull()
  })
})
