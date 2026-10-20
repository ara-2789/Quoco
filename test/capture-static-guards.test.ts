// PR-B (migration 050): static guards T-R7-1, T-A17-1, T-A24-1 ("1a carries NO money values", no confidence, no
// paid / payment). They read the 050 SQL from WHICHEVER path exists: supabase/migrations/ once it has been applied, or
// docs/reviews/ while it is held (CLAUDE.md section 6: a migration enters supabase/migrations/ when it is applied).
// No database access. NOT YET RUN (typechecked only).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const CANDIDATES = ['supabase/migrations/050_material_inward_functions.sql', 'docs/reviews/050_material_inward_functions.sql']

function readSql050(): { path: string; text: string } {
  const hit = CANDIDATES.find((p) => existsSync(resolve(ROOT, p)))
  if (!hit) throw new Error(`050 SQL not found in any of: ${CANDIDATES.join(', ')}`)
  return { path: hit, text: readFileSync(resolve(ROOT, hit), 'utf8') }
}

/** The text of the SEVEN NEW functions only (sections 1a-1g): the replaced live check-in bodies legitimately contain 'total' etc. */
function newFunctionsText(sql: string): string {
  const start = sql.indexOf('-- 1a. apply_material_inward_turn')
  const end = sql.indexOf('-- 2a. apply_morning_flow_turn')
  if (start < 0 || end < 0 || end < start) throw new Error('section markers 1a / 2a not found in the 050 SQL')
  return sql.slice(start, end)
}

/** Drop -- comments and 'string literals' so the guard looks at identifiers, not prose. */
function code(sqlText: string): string {
  return sqlText
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''")
}

const FORBIDDEN = ['confidence', 'paid', 'payment', 'amount', 'rate', 'total', 'price', 'cost']

describe('050 static guards (T-R7-1, T-A17-1, T-A24-1: no money, no confidence, no payment in 1a)', () => {
  it('the 050 SQL is found at one of the two allowed paths', () => {
    expect(CANDIDATES).toContain(readSql050().path)
  })

  it.each(FORBIDDEN)('the seven new functions reference no identifier named %s', (word) => {
    const body = code(newFunctionsText(readSql050().text))
    expect(new RegExp(`\\b${word}\\b`, 'i').test(body)).toBe(false)
  })

  it('the migration adds no table and no column (so it cannot add a money column)', () => {
    const body = code(readSql050().text)
    expect(/\bCREATE\s+TABLE\b/i.test(body)).toBe(false)
    expect(/\bADD\s+COLUMN\b/i.test(body)).toBe(false)
  })

  it('the regenerated types, once they contain the 049 tables, carry no money / confidence / payment column on them', () => {
    const types = readFileSync(resolve(ROOT, 'types/database.ts'), 'utf8')
    for (const table of ['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links']) {
      const at = types.indexOf(`      ${table}: {`)
      if (at < 0) continue // types are regenerated after the apply (D-16); until then there is nothing to scan
      const rowAt = types.indexOf('Row: {', at)
      const rowEnd = types.indexOf('}', rowAt)
      const row = types.slice(rowAt, rowEnd)
      for (const word of FORBIDDEN) expect(new RegExp(`\\b${word}\\b`, 'i').test(row), `${table}.${word}`).toBe(false)
    }
  })
})
