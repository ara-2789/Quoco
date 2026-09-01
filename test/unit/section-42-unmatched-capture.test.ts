import { describe, it, expect } from 'vitest'
import { parseLabourCount } from '@/lib/whatsapp/flows/parsers/labour'
import { parseEquipmentHours } from '@/lib/whatsapp/flows/parsers/equipment-hours'
import { SECTION_42_CORPUS } from '../helpers/section-42-corpus'

// §42 (unmatched trade/equipment tokens are CAPTURED, not silently dropped)
// — TS-PARSER LAYER. Written per Aravind's 2026-08-31 instruction, BEFORE
// any of the three pending parsers (review package §10) are built, so the
// gap is a failing test list rather than something someone has to remember.
//
// EXPECTED-FAIL, NOT SKIPPED — the mechanism, named once here: every target
// assertion below uses Vitest's `it.fails` (confirmed present in the
// installed vitest@3.2.7's ChainableTestAPI — checked directly, not assumed
// from memory). `it.fails` INVERTS the pass/fail signal: if the wrapped
// function throws (as it does today — the feature isn't built), Vitest
// reports the test as PASSED; if it ever stops throwing (the parser was
// built and the assertion now holds), Vitest reports it as FAILED, forcing
// whoever made it pass to come back and remove the `.fails` wrapper. CI
// stays green today, and CI going RED later is the exact signal that a
// pending item was closed — the opposite failure mode from `.skip`/`.todo`,
// which would let the gap go quiet without a build ever noticing either way.
// A companion "documents today's actual behaviour" test sits next to each
// target test, ordinary (not `.fails`), so a reader sees both what's true
// now and what §42 requires, without needing to run anything.
//
// SCOPE, matched to what's actually pending (review package §10) — not
// every by-trade/by-type site in the product, only the three §42 names:
//   1. manpower   — parseLabourCount, EXISTS today, wrong behaviour (drops).
//   2. idle_hours — no parser exists in any form yet.
//   3. equipment_hours — parseEquipmentHours EXISTS today, wrong SHAPE
//      (two-number per-machine, no `type`/`hours_used`/`matched` fields at
//      all — the one-number-per-type redesign, review package §10 item 3).
// Morning Q3 equipment (equipment.ts) is DELIBERATELY NOT in this suite:
// 035_evening_flow_restructuring.sql leaves that branch (`v_col =
// 'equipment'`) untouched — confirmed by reading the SQL directly, not
// assumed — so it carries no pending §42 obligation from this migration.

const manpowerCase = SECTION_42_CORPUS.find((c) => c.site === 'manpower')!
const idleHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'idle_hours')!
const equipmentHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'equipment_hours')!

// Import a module path that may not exist yet, without letting `tsc
// --noEmit` treat that as a compile error. A LITERAL `import('literal/path')`
// argument is resolved by TypeScript exactly like a static import and would
// fail project-wide type-checking before the parser exists (TS2307).
// Building the specifier at runtime keeps the reference untyped
// (`Promise<any>`), so a genuinely-missing module surfaces as an ordinary
// runtime rejection inside the test body — caught by `it.fails` — instead of
// a build-breaking error outside any test's control.
async function importFutureModule(path: string): Promise<any> {
  return import(/* @vite-ignore */ path)
}

describe('§42 unmatched-token capture — site 1: manpower (parseLabourCount, shared by morning Q2 + evening step 2)', () => {
  it.fails('TARGET: an unmatched trade token is preserved in by_trade with matched:false', () => {
    const parse = parseLabourCount(manpowerCase.input)
    const unmatched = parse.by_trade.find((t: any) => t.trade === manpowerCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect((unmatched as any).matched).toBe(false)
  })

  it('TODAY: the unmatched trade token silently vanishes from by_trade — the total still counts it', () => {
    const parse = parseLabourCount(manpowerCase.input)
    expect(parse.by_trade.find((t) => t.trade === manpowerCase.unmatchedToken)).toBeUndefined()
    expect(parse.by_trade.find((t) => t.trade === manpowerCase.matchedToken)).toEqual({
      trade: manpowerCase.matchedToken,
      planned_count: manpowerCase.matchedCount,
    })
    expect(parse.planned_total).toBe((manpowerCase.matchedCount ?? 0) + 11) // 25 + 11 — attribution lost, arithmetic isn't
  })
})

describe('§42 unmatched-token capture — site: idle_hours (evening step 3, no parser exists yet)', () => {
  it.fails('TARGET: parseIdleHoursByTrade exists and preserves the unmatched trade token', async () => {
    const mod = await importFutureModule('@/lib/whatsapp/flows/parsers/idle-hours')
    const parse = mod.parseIdleHoursByTrade(idleHoursCase.input)
    const unmatched = parse.by_trade.find((t: any) => t.trade === idleHoursCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched.matched).toBe(false)
  })

  it('TODAY: the module does not exist at all — there is no idle-hours-by-trade capture of any kind', async () => {
    await expect(importFutureModule('@/lib/whatsapp/flows/parsers/idle-hours')).rejects.toBeTruthy()
  })
})

describe('§42 unmatched-token capture — site: equipment_hours (evening step 4 redesign, wrong shape today)', () => {
  it.fails('TARGET: an unmatched equipment token is preserved as {type, hours_used, matched:false}', () => {
    const parse = parseEquipmentHours(equipmentHoursCase.input)
    const item = parse.items.find((i: any) => i.raw.includes(equipmentHoursCase.unmatchedToken))
    expect(item).toBeDefined()
    expect((item as any).type).toBe(equipmentHoursCase.unmatchedToken)
    expect((item as any).matched).toBe(false)
    expect((item as any).hours_used).toBe(4)
  })

  it("TODAY: parseEquipmentHours has no type/matched/hours_used fields — it's the old two-number-per-machine shape", () => {
    const parse = parseEquipmentHours(equipmentHoursCase.input)
    const item = parse.items.find((i) => i.raw.includes(equipmentHoursCase.unmatchedToken))
    expect(item).toBeDefined()
    expect((item as any).type).toBeUndefined()
    expect((item as any).matched).toBeUndefined()
    expect((item as any).hours_used).toBeUndefined()
    // The old shape DOES still capture the number, just under the wrong key —
    // available_hours, not hours_used — and canonical_type is null rather
    // than the raw token being preserved as `type`.
    expect(item!.available_hours).toBe(4)
    expect(item!.canonical_type).toBeNull()
  })
})
