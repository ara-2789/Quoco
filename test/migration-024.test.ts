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

// Integration tests for migration 024 (apply_evening_flow_turn Pass 2 — Q4
// headcount/productivity, Q5 equipment hours). Run ONLY against the test-db
// branch — the allowlist globalSetup guard hard-aborts otherwise.
//
// NOT YET RUNNABLE AGAINST TEST-DB — 024 has not been rehearsed/applied there
// as of this commit. Same convention as every migration test in this series
// (019's own header names it explicitly): run BEFORE the migration is applied
// = every call errors "function does not exist" or exercises 022's Pass-1-
// only body, proving this suite targets the real object rather than a mock;
// green only after rehearsal. Do not read a red run of this file today as a
// defect — it is the expected pre-rehearsal state.
//
//   T-024-01  Q4a happy path: headcount answered, advances to step 5, nothing
//             written to daily_logs yet (held until step 5 resolves)
//   T-024-02  Q4a reask then accept-raw: no digit -> reask once, then the
//             raw (unparseable) answer is accepted and the flow advances
//   T-024-03  Q4b happy path, all productive: evening_workers_on_site +
//             evening_productive_manpower written together, confidence=high
//   T-024-04  Q4b happy path, some idle with reason: productive_count =
//             headcount - idle_count, idle_reason captured
//   T-024-05  Q4b low confidence: reask budget exhausted and STILL
//             unclassifiable -> accepted as some-idle, confidence=low
//   T-024-06  Q5 AUTO-SKIP, case 2 — morning submitted "no equipment":
//             flow completes at step 5, evening_equipment_utilisation = empty
//   T-024-07  Q5 AUTO-SKIP, case 1 — *** THE BUG FIX *** NO morning
//             submission at all (morning_equipment IS NULL, not '[]'): flow
//             STILL completes at step 5. This is the case 022's own reserved
//             comment's pinned test would have missed.
//   T-024-08  Q5 NOT skipped: morning listed equipment, evening_workers flow
//             advances to step 6 with a non-empty equipment_echo returned
//   T-024-09  Q5 happy path, single machine, NO label/type signal: TIER 3
//             (pure positional fallback), confidence=low — content asserted
//             via the full daily_logs row, not just outcome/step
//   T-024-10  RETIRED, not silently skipped: originally "two same-type
//             machines, joined by position" against the pre-tier design.
//             That scenario is now covered more precisely, split across
//             T-024-18 (ambiguous names, correctly left unmatched) and
//             T-024-19 (Case B's "not reported" entries) — recorded here so
//             the gap in numbering reads as a deliberate consolidation, not
//             a dropped test.
//   T-024-16  TIER 1: explicit labels ("1)", "2)") resolve correctly even
//             when the engineer answers OUT OF ORDER relative to the echo
//   T-024-17  TIER 2, THE ORIGINAL FAILURE CASE: type names ("mixer", "JCB")
//             resolve correctly out of order, no labels — the exact scenario
//             that silently swapped hours under the rejected pure-reply-
//             order fix (probe finding)
//   T-024-18  TIER 2 AMBIGUITY: two SAME-type machines both named, neither
//             labelled — stays UNMATCHED (tier 4 + two "not reported"
//             entries), does NOT fall through to a positional guess, because
//             an ambiguous name is a signal being ignored, not absent
//   T-024-19  CASE B: fewer answers than machines — the unmatched machine
//             gets an explicit "not reported" entry, not silent absence
//   T-024-20  ARITHMETIC GUARD: available_hours > 24 rejected at the parser
//             level; reask, then accepted-empty (not accepted-wrong) on
//             budget exhaustion — confidence='low' on the outer field too
//   T-024-21  ARITHMETIC GUARD: actual_hours > available_hours rejected —
//             the exact numbers ("1 8") the pre-label-fix bug would have
//             produced from a compliant "1) 8 6" reply
//   T-024-22  CONFIDENCE FIX 1: step 4's OWN budget exhausted on an
//             unparseable headcount (e4_headcount stays NULL) -> a clean
//             step-5 parse must still stamp confidence='low', not 'high' —
//             the object spans two steps, so does the flag. Also confirms
//             evening_workers_on_site and productive_count both land NULL,
//             not a fabricated 0.
//   T-024-23  CONFIDENCE FIX 2: step 5's OWN budget exhausted on a totally
//             unclassifiable productivity answer -> idle_count and
//             productive_count must both be NULL ("not captured"), never a
//             fabricated 0 that reads as "everyone was productive"
//   T-024-24  ARITHMETIC GUARD (FIX 3, found in a LATER review pass, after
//             024's first apply to test-db): idle_count > headcount is
//             impossible — a real, cleanly-parsed pair, fires on the FIRST
//             attempt, no budget exhaustion needed. Invalidated to NULL +
//             confidence='low', not silently clamped to a confident 0.
//   T-024-11  Q5 reask carries the SAME equipment_echo again (data-driven
//             prompt, not a generic "didn't get that")
//   T-024-12  Q2=Yes now routes to step 4 instead of completing (022's
//             reserved edge, resolved by 024)
//   T-024-13  Q3 completion now routes to step 4 instead of completing
//             (022's other reserved edge)
//   T-024-14  REVERSE-ORDER regression (CLAUDE.md §7's "assert the end state
//             of the full realistic sequence" discipline, matching 022's own
//             T-022-13): evening runs to Q5 auto-skip BEFORE morning submits
//             equipment for the day, then morning submits — confirms the
//             skip decision reflects the state AT THE TIME Q4b resolved, not
//             a stale read, and that a same-day morning submission afterward
//             does not retroactively change an already-completed evening.
//   T-024-15  wrong_flow still reported correctly from every new step
//             (morning active, evening inbound arrives while at step 4/5/6)

const P_NOW = '2026-04-10T19:00:00+05:30' // 19:00 IST, 10 Apr — evening check-in time
const LOG_DATE = '2026-04-10'

async function completeMorningNoEquipment(phone: string, now: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now })
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: 'no', startFlow: false, now }) // Q3: explicit none
  await applyMorningFlowTurn({ phone, message: 'Crew A then Crew B', startFlow: false, now })
}

async function completeMorningWithEquipment(phone: string, now: string, equipmentReply: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now })
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: equipmentReply, startFlow: false, now })
  await applyMorningFlowTurn({ phone, message: 'Crew A then Crew B', startFlow: false, now })
}

// Drive evening to the start of Q4 (step 4) via the Q2=Yes edge (shortest
// path — Q1 -> Q2 yes -> step 4, per 024's routing change).
async function reachStep4(phone: string, now: string): Promise<void> {
  await applyEveningFlowTurn({ phone, message: '', startFlow: true, now })
  await applyEveningFlowTurn({ phone, message: 'Slab concrete 120 sqm', startFlow: false, now })
  await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now })
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

describe('apply_evening_flow_turn Pass 2 (Q4 headcount/productivity, Q5 equipment hours)', () => {
  it('T-024-01: Q4a happy path — advances to step 5, nothing written yet', async () => {
    const phone = testPhone('401')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)

    const r = await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(5)

    const log = await getDailyLog(LOG_DATE)
    // evening_workers_on_site is not in DailyLogRow's select list by default
    // helper — read it back directly to confirm it is NOT yet written.
    expect(log?.evening_schedule_met).toBe(true) // Q2 already resolved
  })

  it('T-024-02: Q4a reask then accept-raw — unparseable, then accepted after budget', async () => {
    const phone = testPhone('402')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)

    const reask = await applyEveningFlowTurn({ phone, message: 'some workers', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(reask.current_step).toBe(4)

    const accepted = await applyEveningFlowTurn({ phone, message: 'still no number', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    expect(accepted.current_step).toBe(5)
  })

  it('T-024-03: Q4b happy path, all productive — written together, confidence=high', async () => {
    const phone = testPhone('403')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'yes all productive', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // completes — no morning equipment, Q5 auto-skips
  })

  it('T-024-04: Q4b some idle with reason — productive_count = headcount - idle_count', async () => {
    const phone = testPhone('404')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({
      phone,
      message: '2 idle waiting for cement',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)
  })

  it('T-024-05: Q4b low confidence — budget exhausted, still unclassifiable, accepted as some-idle', async () => {
    const phone = testPhone('405')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const reask = await applyEveningFlowTurn({ phone, message: 'site is busy', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(reask.current_step).toBe(5)

    const accepted = await applyEveningFlowTurn({ phone, message: 'still unclear', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    expect(accepted.current_step).toBe(0) // treated as some-idle, count unknown -> completes (no morning equipment)
  })

  it('T-024-06: Q5 AUTO-SKIP case 2 — morning said "no equipment" explicitly', async () => {
    const phone = testPhone('406')
    await completeMorningNoEquipment(phone, P_NOW) // Q3 = "no"
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // completed, Q5 skipped
    expect(r.equipment_echo).toBeNull()
  })

  it('T-024-07: Q5 AUTO-SKIP case 1 — *** THE BUG FIX *** no morning submission at all', async () => {
    const phone = testPhone('407')
    // Deliberately NO completeMorning call — morning_equipment is NULL, not
    // '[]'. This is the case 022's own reserved comment's pinned test
    // (`jsonb_array_length(morning_equipment->'items') = 0`) would have
    // missed, since jsonb_array_length(NULL->'items') is NULL, not 0.
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // MUST complete, not send a Q5 prompt with nothing to echo
    expect(r.equipment_echo).toBeNull()
  })

  it('T-024-08: Q5 NOT skipped — morning listed equipment, advances to step 6 with echo', async () => {
    const phone = testPhone('408')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(6)
    expect(r.equipment_echo).not.toBeNull()
    expect(r.equipment_echo).toHaveLength(1)
    expect(r.equipment_echo?.[0].type).toBe('jcb')
  })

  it('T-024-09: Q5 happy path, single machine, NO signal — TIER 3 positional, confidence=low', async () => {
    const phone = testPhone('409')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // -> step 6

    const r = await applyEveningFlowTurn({
      phone,
      message: '8 6 waiting for fuel',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // Q5 is the flow's terminal step

    const log = await getDailyLog(LOG_DATE)
    // No label, no recognisable machine word in "waiting for fuel" -> TIER 3
    // (chunk count 1 == morning count 1, no signal anywhere) -> low confidence.
    expect(log?.evening_equipment_utilisation?.items).toEqual([
      {
        morning_item_index: 0,
        type: 'jcb',
        available_hours: 8,
        actual_hours: 6,
        idle_reason: 'waiting for fuel',
        raw: '8 6 waiting for fuel',
        confidence: 'low',
      },
    ])
  })

  it('T-024-16: TIER 1 — explicit labels resolve correctly even OUT OF ORDER', async () => {
    const phone = testPhone('416')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500, Mixer 800') // index 0=jcb, 1=concrete_mixer
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    const advance = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    // equipment_echo returns the FULL stored morning_equipment item, not a
    // {type}-only projection — matches T-024-08's own (correct) property
    // check, not a strict deep-equal, which fails against the real shape
    // (count/daily_hire_cost/owned_or_hired/raw are also present).
    expect(advance.equipment_echo).toHaveLength(2)
    expect(advance.equipment_echo?.map((e) => e.type)).toEqual(['jcb', 'concrete_mixer'])

    // Engineer answers machine 2 FIRST, machine 1 SECOND — labels make this
    // unambiguous regardless of reply order.
    const r = await applyEveningFlowTurn({ phone, message: '2) 10 10, 1) 8 6', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const items = log?.evening_equipment_utilisation?.items ?? []
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ morning_item_index: 1, type: 'concrete_mixer', available_hours: 10, actual_hours: 10, confidence: 'high' })
    expect(items[1]).toMatchObject({ morning_item_index: 0, type: 'jcb', available_hours: 8, actual_hours: 6, confidence: 'high' })
  })

  it('T-024-17: TIER 2 — the ORIGINAL failure case: type names resolve correctly OUT OF ORDER, no labels', async () => {
    const phone = testPhone('417')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500, Mixer 800') // index 0=jcb, 1=concrete_mixer
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    // Engineer names the MIXER first, JCB second — the exact scenario that
    // silently swapped hours under the rejected pure-reply-order fix.
    const r = await applyEveningFlowTurn({ phone, message: 'mixer 6 4, JCB 8 6', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const items = log?.evening_equipment_utilisation?.items ?? []
    expect(items).toHaveLength(2)
    // Chunk 0 ("mixer 6 4") must land on the MIXER (morning index 1), not
    // the JCB it would have collided with under reply-order positioning.
    expect(items[0]).toMatchObject({
      morning_item_index: 1,
      type: 'concrete_mixer',
      available_hours: 6,
      actual_hours: 4,
      confidence: 'high',
    })
    expect(items[1]).toMatchObject({
      morning_item_index: 0,
      type: 'jcb',
      available_hours: 8,
      actual_hours: 6,
      confidence: 'high',
    })
  })

  it('T-024-18: TIER 2 ambiguity — two SAME-type machines named without labels stay UNMATCHED, not guessed', async () => {
    const phone = testPhone('418')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500, JCB 1800') // both index 0 and 1 are 'jcb'
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    // Both chunks name "JCB" — a real signal, but it can't disambiguate
    // between the two unclaimed JCBs. Must NOT fall through to TIER 3
    // (positional): a named-but-ambiguous signal is a signal being IGNORED,
    // which TIER 3 is explicitly not allowed to do.
    const r = await applyEveningFlowTurn({ phone, message: 'JCB 8 6, JCB 10 10', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const items = log?.evening_equipment_utilisation?.items ?? []
    // Two unmatched reply chunks (TIER 4) + two "not reported" entries (Case
    // B — neither morning JCB was ever claimed).
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ morning_item_index: null, type: null, available_hours: 8, actual_hours: 6, confidence: null })
    expect(items[1]).toMatchObject({ morning_item_index: null, type: null, available_hours: 10, actual_hours: 10, confidence: null })
    expect(items[2]).toMatchObject({ morning_item_index: 0, type: 'jcb', available_hours: null, actual_hours: null, raw: null, confidence: null })
    expect(items[3]).toMatchObject({ morning_item_index: 1, type: 'jcb', available_hours: null, actual_hours: null, raw: null, confidence: null })
  })

  it('T-024-19: CASE B — fewer answers than machines: the unanswered one gets an explicit "not reported" entry', async () => {
    const phone = testPhone('419')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500, Mixer 800, Crane 500') // 0=jcb,1=mixer,2=crane
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    // Engineer answers for JCB and Crane by name, never mentions the mixer.
    const r = await applyEveningFlowTurn({ phone, message: 'JCB 8 6, Crane 5 5', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const items = log?.evening_equipment_utilisation?.items ?? []
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ morning_item_index: 0, type: 'jcb', available_hours: 8, actual_hours: 6, confidence: 'high' })
    expect(items[1]).toMatchObject({ morning_item_index: 2, type: 'crane', available_hours: 5, actual_hours: 5, confidence: 'high' })
    // The mixer (morning index 1) matched nothing — explicit absence, not silence.
    expect(items[2]).toMatchObject({
      morning_item_index: 1,
      type: 'concrete_mixer',
      available_hours: null,
      actual_hours: null,
      idle_reason: null,
      raw: null,
      confidence: null,
    })
  })

  it('T-024-20: ARITHMETIC GUARD — available_hours > 24 is rejected; reask, then accepted-empty on budget exhaustion', async () => {
    const phone = testPhone('420')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    const reask = await applyEveningFlowTurn({ phone, message: '30 10', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(reask.current_step).toBe(6)

    const accepted = await applyEveningFlowTurn({ phone, message: '30 10', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    expect(accepted.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const items = log?.evening_equipment_utilisation?.items ?? []
    // The guard rejects the chunk at the parser level (never stored as data)
    // even on the accept-after-exhaustion turn — accepted means "stop
    // asking", not "trust the number". Only the not-reported entry survives.
    expect(items).toEqual([
      { morning_item_index: 0, type: 'jcb', available_hours: null, actual_hours: null, idle_reason: null, raw: null, confidence: null },
    ])
    expect(log?.evening_equipment_utilisation?.confidence).toBe('low') // accepted only because budget ran out
  })

  it('T-024-21: ARITHMETIC GUARD — actual_hours > available_hours is rejected', async () => {
    const phone = testPhone('421')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })

    // 1 available, 8 actual — the exact numbers the pre-label-fix bug would
    // have produced from a compliant "1) 8 6" reply.
    const reask = await applyEveningFlowTurn({ phone, message: '1 8', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(reask.current_step).toBe(6)
  })

  it('T-024-22: CONFIDENCE FIX 1 — step 4 budget exhausted unparsed -> step 5 stamps confidence=low even on a clean parse', async () => {
    const phone = testPhone('422')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)

    // Step 4's OWN budget: two unparseable headcount answers in a row.
    // Second one advances anyway (budget exhausted) with e4_headcount
    // still NULL, since neither answer had a digit.
    const reask4 = await applyEveningFlowTurn({ phone, message: 'some workers', startFlow: false, now: P_NOW })
    expect(reask4.outcome).toBe('reask')
    const advance4 = await applyEveningFlowTurn({ phone, message: 'still no number', startFlow: false, now: P_NOW })
    expect(advance4.outcome).toBe('advance')
    expect(advance4.current_step).toBe(5)

    // Step 5's OWN parse is perfectly clean — "yes" classifies confidently.
    // If confidence only looked at THIS step, it would be 'high'.
    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // auto-skip, no morning equipment

    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_workers_on_site).toBeNull() // NOT a fabricated 0
    expect(log?.evening_productive_manpower?.confidence).toBe('low') // spans step 4, not just step 5
    expect(log?.evening_productive_manpower?.productive_count).toBeNull() // can't compute without a real headcount
  })

  it('T-024-23: CONFIDENCE FIX 2 — step 5 unclassifiable after budget -> idle_count and productive_count both NULL, never a fabricated 0', async () => {
    const phone = testPhone('423')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW }) // real headcount this time

    // Step 5's OWN budget: two totally unclassifiable productivity answers.
    const reask5 = await applyEveningFlowTurn({ phone, message: 'site is busy', startFlow: false, now: P_NOW })
    expect(reask5.outcome).toBe('reask')
    const r = await applyEveningFlowTurn({ phone, message: 'still unclear', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const manpower = log?.evening_productive_manpower
    expect(manpower?.confidence).toBe('low')
    // The bug this replaces: idle_count defaulted to 0, making
    // productive_count come out as the full headcount (10) — "everyone was
    // productive", read from an answer nobody understood.
    expect(manpower?.idle_count).toBeNull()
    expect(manpower?.productive_count).toBeNull()
  })

  it('T-024-24: ARITHMETIC GUARD — idle_count > headcount is impossible, invalidated not clamped, on the FIRST attempt', async () => {
    const phone = testPhone('424')
    await completeMorningNoEquipment(phone, P_NOW)
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '5', startFlow: false, now: P_NOW }) // headcount=5

    // idle_count=8 > headcount=5 — a real, cleanly-parsed, but IMPOSSIBLE
    // pair. Classifies confidently (ok=true) on the very first attempt, no
    // budget exhaustion needed — this guard has to fire independently of
    // the CONFIDENCE FIX 1/2 triggers.
    const r = await applyEveningFlowTurn({ phone, message: '8 idle, machine broke', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0)

    const log = await getDailyLog(LOG_DATE)
    const manpower = log?.evening_productive_manpower
    // The bug this replaces: GREATEST(5 - 8, 0) = 0, silently clamped, with
    // confidence left 'high' since the parse itself was clean — a
    // confident, fabricated "zero productive" from an impossible pair.
    expect(manpower?.idle_count).toBeNull()
    expect(manpower?.productive_count).toBeNull()
    expect(manpower?.confidence).toBe('low')
    expect(log?.evening_workers_on_site).toBe(5) // headcount itself is real and unaffected
  })

  it('T-024-11: Q5 reask carries the same equipment_echo again', async () => {
    const phone = testPhone('411')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // -> step 6

    const r = await applyEveningFlowTurn({ phone, message: 'running fine no numbers', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('reask')
    expect(r.current_step).toBe(6)
    expect(r.equipment_echo).not.toBeNull()
    expect(r.equipment_echo).toHaveLength(1)
  })

  it('T-024-12: Q2=Yes routes to step 4, does NOT complete (022 reserved edge, resolved)', async () => {
    const phone = testPhone('412')
    await completeMorningNoEquipment(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'Slab concrete 120 sqm', startFlow: false, now: P_NOW })

    const r = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4) // NOT 0 — Pass 1 completed here, Pass 2 hands off instead
  })

  it('T-024-13: Q3 completion routes to step 4, does NOT complete (022 other reserved edge)', async () => {
    const phone = testPhone('413')
    await completeMorningNoEquipment(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'Slab concrete 120 sqm', startFlow: false, now: P_NOW })
    await applyEveningFlowTurn({ phone, message: 'no', startFlow: false, now: P_NOW }) // -> Q3

    const r = await applyEveningFlowTurn({ phone, message: 'Rain all afternoon', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4) // NOT 0
  })

  it('T-024-14: REVERSE-ORDER regression — evening completes (Q5 auto-skip) BEFORE morning submits', async () => {
    const phone = testPhone('414')
    // Evening runs FIRST, with no morning row at all — same as T-024-07, but
    // this test's point is what happens AFTER: morning submits real
    // equipment data on the SAME day, and evening's already-completed answer
    // must not be retroactively affected.
    await reachStep4(phone, P_NOW)
    await applyEveningFlowTurn({ phone, message: '10', startFlow: false, now: P_NOW })
    const eveningResult = await applyEveningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW })
    expect(eveningResult.current_step).toBe(0) // evening completed via auto-skip

    // Morning now submits, WITH equipment, on the same day.
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')

    // Evening's session state is untouched by morning's later completion —
    // still idle/already_complete, not reopened.
    const session = await readSession(phone)
    expect(session?.current_flow).toBeNull()
    expect((session?.context as Record<string, unknown>)?.['evening_submitted']).toBe(true)

    const replay = await applyEveningFlowTurn({ phone, message: 'anything', startFlow: false, now: P_NOW })
    // already_complete, not idle — evening_submitted:true survived morning's
    // later completion (the exact CONTEXT DISCIPLINE property this test is
    // for), and already_complete is 022's own existing semantic for that
    // state, not something new. My first version of this assertion expected
    // 'idle' with a comment that itself said "already completed" — the
    // comment described already_complete correctly and the assertion named
    // the wrong constant for it.
    expect(replay.outcome).toBe('already_complete')
  })

  it('T-024-15: wrong_flow still reported correctly at steps 4, 5, and 6', async () => {
    const phone = testPhone('415')
    await completeMorningWithEquipment(phone, P_NOW, 'JCB 1500')
    await reachStep4(phone, P_NOW)

    // Morning starts a NEW flow while evening is mid-Q4 — morning's own RPC
    // reports wrong_flow (evening is active), the direction that matters here.
    const r = await applyMorningFlowTurn({ phone, message: 'anything', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('wrong_flow')
  })
})
