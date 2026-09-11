import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COLUMN_CONTRACT, UI_VISIBLE_COLUMNS } from '@/lib/daily-logs/correction'

// Migration 019 originally duplicated its column whitelist across the table
// CHECK and the RPC's CASE (see 019's own comment at the CHECK definition:
// "the CHECK/CASE whitelist duplication is load-bearing... do not simplify
// it away") -- an invariant that held from 019 through migration 039.
//
// UPDATED 2026-09-11 (migration 040, FIX 1/B1, external review round 1):
// the CHECK and CASE no longer carry the SAME key set, DELIBERATELY. A CHECK
// constraint describes what rows may EXIST -- history included -- so 040's
// STEP 5 RETAINS evening_schedule_miss_reason in the CHECK (a real
// historical daily_log_edits row against it exists on prod, confirmed at
// apply time) while STEP 6's CASE drops it (write-prevention for a frozen
// column belongs at the RPC, which controls FUTURE corrections, not at the
// CHECK). COLUMN_CONTRACT mirrors the CASE, not the CHECK -- it is a
// correctability contract (what a PM may correct going forward), and the
// CASE is what actually governs that.
//
// Both whitelists are parsed off migration 040's file specifically, not
// 019's -- 040 is the most recent migration to touch either list, and
// (like every migration before it) restates BOTH in full: ALTER TABLE ...
// ADD CONSTRAINT takes the complete CHECK expression, CREATE OR REPLACE
// FUNCTION takes the complete function body including the complete CASE.
// A single file is therefore self-sufficient as the current authoritative
// source for both -- no need to diff across 019 and 040 by hand, which is
// exactly the hand-reconstruction risk migration 040's own header names as
// the root cause of its 038 near-miss, applied here to a test instead of a
// migration.

const MIGRATION_PATH = resolve(process.cwd(), 'supabase/migrations/040_evening_q5_tomorrow_needs.sql')

function parseCheckWhitelist(sql: string): string[] {
  const match = sql.match(/CHECK \(column_name IN \(([\s\S]*?)\)\);/)
  if (!match) throw new Error('column-contract.test.ts: could not find the table CHECK whitelist in 040')
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

function parseCaseWhitelist(sql: string): Record<string, string> {
  const match = sql.match(/CASE p_column([\s\S]*?)ELSE NULL/)
  if (!match) throw new Error('column-contract.test.ts: could not find the RPC CASE whitelist in 040')
  const out: Record<string, string> = {}
  for (const m of match[1].matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z]+)'/g)) {
    out[m[1]] = m[2]
  }
  return out
}

describe('COLUMN_CONTRACT vs. migration 040 (parsed off disk)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const checkList = parseCheckWhitelist(sql)
  const caseMap = parseCaseWhitelist(sql)

  it('the table CHECK and the RPC CASE deliberately DIFFER by exactly one column, both ways -- 040s own retained-vs-removed split (FIX 1/B1)', () => {
    // CHECK retains evening_schedule_miss_reason (history); CASE does not
    // (no future corrections). Both are true simultaneously post-040 --
    // this is NOT the pre-040 "they must agree" invariant, it is its
    // deliberate replacement.
    expect(checkList).toContain('evening_schedule_miss_reason')
    expect(checkList).toContain('evening_tomorrow_needs')
    expect(Object.keys(caseMap)).not.toContain('evening_schedule_miss_reason')
    expect(Object.keys(caseMap)).toContain('evening_tomorrow_needs')
    // Everything else genuinely does still agree -- the two lists differ
    // by exactly the one retained-for-history column.
    const checkMinusHistorical = new Set(checkList.filter((c) => c !== 'evening_schedule_miss_reason'))
    expect(checkMinusHistorical).toEqual(new Set(Object.keys(caseMap)))
  })

  it('COLUMN_CONTRACT has exactly the same key set as the RPC CASE (the correctability gate, not the CHECK)', () => {
    expect(new Set(Object.keys(COLUMN_CONTRACT))).toEqual(new Set(Object.keys(caseMap)))
  })

  it("COLUMN_CONTRACT's per-column cast type matches the RPC CASE exactly", () => {
    for (const [column, castType] of Object.entries(caseMap)) {
      expect(COLUMN_CONTRACT[column as keyof typeof COLUMN_CONTRACT]).toBe(castType)
    }
  })

  it('UI_VISIBLE_COLUMNS is COLUMN_CONTRACT minus exactly `weather`', () => {
    const expected = new Set(Object.keys(COLUMN_CONTRACT))
    expected.delete('weather')
    expect(new Set(UI_VISIBLE_COLUMNS)).toEqual(expected)
    expect(UI_VISIBLE_COLUMNS).not.toContain('weather')
  })
})
