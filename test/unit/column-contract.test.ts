import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COLUMN_CONTRACT, UI_VISIBLE_COLUMNS } from '@/lib/daily-logs/correction'

// Migration 019 deliberately duplicates its column whitelist across the table
// CHECK and the RPC's CASE (see the migration's own comment at the CHECK
// definition: "the CHECK/CASE whitelist duplication is load-bearing... do not
// simplify it away"). This test makes COLUMN_CONTRACT a REAL third gate on
// that same shape — parsed off the actual migration file on disk, not
// hand-copied — so a future migration that widens one list and forgets the
// other, or forgets this map, fails a test instead of drifting silently.

const MIGRATION_PATH = resolve(process.cwd(), 'supabase/migrations/019_daily_log_corrections.sql')

function parseCheckWhitelist(sql: string): string[] {
  const match = sql.match(/CHECK \(column_name IN \(([\s\S]*?)\)\),/)
  if (!match) throw new Error('column-contract.test.ts: could not find the table CHECK whitelist in 019')
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

function parseCaseWhitelist(sql: string): Record<string, string> {
  const match = sql.match(/CASE p_column([\s\S]*?)ELSE NULL/)
  if (!match) throw new Error('column-contract.test.ts: could not find the RPC CASE whitelist in 019')
  const out: Record<string, string> = {}
  for (const m of match[1].matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z]+)'/g)) {
    out[m[1]] = m[2]
  }
  return out
}

describe('COLUMN_CONTRACT vs. migration 019 (parsed off disk)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const checkList = parseCheckWhitelist(sql)
  const caseMap = parseCaseWhitelist(sql)

  it('the table CHECK and the RPC CASE agree with each other (019s own invariant)', () => {
    expect(new Set(checkList)).toEqual(new Set(Object.keys(caseMap)))
  })

  it('COLUMN_CONTRACT has exactly the same key set as 019s whitelist', () => {
    expect(new Set(Object.keys(COLUMN_CONTRACT))).toEqual(new Set(checkList))
  })

  it('COLUMN_CONTRACT\'s per-column cast type matches the RPC CASE exactly', () => {
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
