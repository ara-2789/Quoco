import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { describe, it, expect } from 'vitest'

// STATIC SOURCE GUARD (same technique/family as outbound-trigger-cas-
// invariant.test.ts's CAS guard and jobs-claim-index.test.ts's index/
// query-predicate guard) for the invariant the test-db-only grant
// divergence depends on.
//
// External review round 2 (2026-09-14, migration 043's GO-FOR-PROD verdict,
// the one blocking condition): `scripts/test-db-only-grants.sql` grants
// `service_role` DELETE on `outbound_sends` and `daily_log_photos`, TEST-DB
// ONLY -- both tables' own prod migrations deliberately REVOKE that exact
// privilege, because both are append-only/tombstone-only by design. That
// divergence is safe ONLY on ONE condition: application code (lib/, app/)
// never itself issues a DELETE against either table -- test cleanup is the
// ONLY intended user of the test-db-only grant. Until this file existed,
// that condition was ASSUMED, never enforced -- nothing would have caught a
// future `lib/` change that added a `.delete()` call against one of these
// tables, and on test-db it would have silently SUCCEEDED (masking the
// production REVOKE's own denial, since a passing local/test run gives no
// signal that the very same code would 42501 in prod).
//
// This test scans the REAL SOURCE of every file under lib/ and app/, not a
// re-implementation of Supabase's query builder -- a `.from('table').
// delete(` call (or a raw SQL `DELETE FROM table` literal) reaching either
// tracked table fails THIS test directly, without needing a database.
// test/ and scripts/ are OUT OF SCOPE (the grants file's own header: test
// cleanup is the PERMITTED side of the boundary) -- this guard's job is
// `lib/`+`app/` only.
//
// THE TABLE LIST IS READ FROM scripts/test-db-only-grants.sql, NEVER
// HARDCODED HERE -- adding a third table to that file's own divergence
// automatically extends this guard's coverage on the next run, with no
// edit needed in this file.

const REPO_ROOT = join(__dirname, '..', '..')
const GRANTS_SCRIPT_PATH = join(REPO_ROOT, 'scripts/test-db-only-grants.sql')
const SCAN_DIRS = ['lib', 'app']

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

/**
 * Every table scripts/test-db-only-grants.sql grants service_role DELETE
 * on, test-db only. Parsed from the file's own `GRANT DELETE ON
 * public.<table> TO service_role;` lines -- this is the single source of
 * truth this guard's coverage tracks; nothing in this file names a table
 * by hand.
 */
function tablesWithTestDbOnlyDelete(): string[] {
  const sql = stripSqlComments(readFileSync(GRANTS_SCRIPT_PATH, 'utf8'))
  const matches = [...sql.matchAll(/GRANT\s+DELETE\s+ON\s+public\.(\w+)\s+TO\s+service_role\s*;/gi)]
  if (matches.length === 0) {
    throw new Error(
      `no-app-delete-invariant: found zero "GRANT DELETE ON public.<table> TO service_role;" ` +
        `lines in ${GRANTS_SCRIPT_PATH} -- either that file's format changed (this parser's own ` +
        `regex needs updating to match) or the file is genuinely empty, which would itself be ` +
        `surprising given the outbound_sends/daily_log_photos entries this guard was built for. ` +
        `Failing loudly rather than silently scanning zero tables.`,
    )
  }
  return matches.map((m) => m[1])
}

// Same technique as outbound-trigger-cas-invariant.test.ts's stripComments
// -- strips block comments, then line comments (the `([^:]|^)` guard keeps
// a `://` inside a URL string from being read as a line-comment start).
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^:]|^)\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (extname(full) === '.ts' || extname(full) === '.tsx') {
      out.push(full)
    }
  }
  return out
}

interface Violation {
  file: string
  table: string
  snippet: string
}

/**
 * Scans every .ts/.tsx file under lib/ and app/ for a DELETE against any
 * table named in scripts/test-db-only-grants.sql -- a chained Supabase
 * `.from('table').delete(` call (the exact shape every real delete call in
 * this codebase's OWN test helpers already uses -- confirmed by grep
 * before this guard was written), or a raw SQL `DELETE FROM table` string
 * literal (defensive: no such code path exists in lib/app today, but this
 * catches one being ADDED).
 */
function findAppCodeDeleteViolations(tables: string[]): Violation[] {
  const violations: Violation[] = []
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)))

  for (const file of files) {
    const source = stripTsComments(readFileSync(file, 'utf8'))

    for (const table of tables) {
      const chainedRe = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)\\s*\\.delete\\s*\\(`, 'g')
      for (const m of source.matchAll(chainedRe)) {
        violations.push({ file, table, snippet: m[0] })
      }

      const rawSqlRe = new RegExp(`DELETE\\s+FROM\\s+(?:public\\.)?${table}\\b`, 'gi')
      for (const m of source.matchAll(rawSqlRe)) {
        violations.push({ file, table, snippet: m[0] })
      }
    }
  }

  return violations
}

describe('no-app-delete-invariant (static source guard, outbound_sends/daily_log_photos test-db-grant family)', () => {
  const tables = tablesWithTestDbOnlyDelete()

  it('finds the expected test-db-only DELETE grants -- fails loudly if scripts/test-db-only-grants.sql\'s shape changes, rather than silently guarding zero tables', () => {
    expect(tables).toEqual(expect.arrayContaining(['outbound_sends', 'daily_log_photos']))
    expect(tables.length).toBeGreaterThanOrEqual(2)
  })

  it('no application code (lib/, app/) issues a DELETE against a table where service_role DELETE exists ONLY as a test-db-only grant', () => {
    const violations = findAppCodeDeleteViolations(tables)
    if (violations.length > 0) {
      const detail = violations.map((v) => `  ${v.file}: table "${v.table}" via \`${v.snippet}\``).join('\n')
      throw new Error(
        `no-app-delete-invariant FAILED -- application code deletes against a table whose ` +
          `service_role DELETE grant exists ONLY for test-db cleanup ` +
          `(scripts/test-db-only-grants.sql). That divergence (CLAUDE.md's own "OUTBOUND_SENDS' ` +
          `GRANTS NOW DIFFER BETWEEN TEST-DB AND PROD" rule, and 043_daily_log_photos.sql's ` +
          `identical shape) is safe ONLY because application code never exercises the privilege ` +
          `test cleanup depends on -- prod's own migration revokes it entirely, so this exact code ` +
          `would 42501 in production, but on test-db it would silently SUCCEED, hard-deleting rows ` +
          `a table's own design says must be tombstoned, never removed. Violations:\n${detail}`,
      )
    }
    expect(violations).toEqual([])
  })
})
