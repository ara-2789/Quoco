import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// D4 (docs/reviews/047-review-package.md; migration 047, hindrances.
// report_date's own sibling review package -- 047 revokes unused table
// rights). STATIC SOURCE GUARD, same technique/family as test/unit/
// no-app-delete-invariant.test.ts and test/hindrance-photos-rls.test.ts's
// own grant-shape tests.
//
// WHY STATIC, NOT A LIVE pg_catalog QUERY -- NAMED, NOT ASSUMED AWAY.
// test/hindrance-photos-rls.test.ts's own header already established this
// for this exact codebase: "the Supabase JS/PostgREST client has no
// general 'run arbitrary SQL' entry point, so a live has_table_privilege()
// probe ... cannot be re-run inside this vitest suite." information_schema
// and pg_catalog are not exposed through PostgREST's own configured schema
// list (public only) -- there is no supabase/config.toml in this repo to
// re-check that against locally, so this restates the codebase's own prior,
// already-investigated finding rather than re-deriving it. Genuine
// DB-level enforcement of the same invariant this test checks happens two
// other ways, NEITHER of which is this file: (1) migration 047's own final
// DO block RAISEs EXCEPTION and aborts the whole apply if any public table
// still grants DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN to anon/
// authenticated, or any polcmd 'd' policy remains -- that runs live, in
// the real database, at apply time; (2) this migration's own rehearsal
// (a later pass -- this one is write + review package only, per D6's
// stated order) runs live has_table_privilege()/pg_policy probes via
// `supabase db query --linked`, the same CLI-level path this migration's
// own review package step 1 used to capture the pre-apply state. THIS
// test's job is narrower and earlier: catch a hand-edit mistake in
// 047's own SQL file -- a table silently missing its REVOKE line, or a
// policy name typo in a DROP POLICY statement -- before the file is ever
// applied anywhere, the same shape 044's own static grant-shape guard
// already established for one table.
//
// TABLE LIST DERIVED FROM MIGRATION HISTORY, NEVER HARDCODED HERE --
// same principle as no-app-delete-invariant.test.ts's own table list.
// Every `CREATE TABLE [public.]<name>` across supabase/migrations/*.sql is
// scanned; confirmed live, this migration's own review package step 1,
// that no table has ever been dropped or renamed in this project's history
// (grepped: zero DROP TABLE, zero table-level RENAME TO, across every
// migration file) -- so the CREATE-TABLE set IS the current live table
// set, with no drop/rename bookkeeping needed.

const REPO_ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')
const MIGRATION_047_CANDIDATES = [
  join(REPO_ROOT, 'supabase', 'migrations', '047_revoke_unused_table_rights.sql'),
  join(REPO_ROOT, 'docs', 'reviews', '047_revoke_unused_table_rights.sql'),
]

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

function discoverPublicTables(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  const tables = new Set<string>()
  const re = /CREATE\s+TABLE\s+(?:public\.)?"?(\w+)"?\s*\(/gi
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    for (const m of sql.matchAll(re)) {
      tables.add(m[1])
    }
  }
  return [...tables].sort()
}

function read047(): string {
  const path = MIGRATION_047_CANDIDATES.find((p) => {
    try {
      readFileSync(p)
      return true
    } catch {
      return false
    }
  })
  if (!path) {
    throw new Error(`047_revoke_unused_table_rights.sql not found in any expected location: ${MIGRATION_047_CANDIDATES.join(', ')}`)
  }
  return readFileSync(path, 'utf8')
}

// D2's 17 DELETE-command policies -- verbatim from the decision list,
// cross-checked live against pg_policy (polcmd = 'd') by this migration's
// own review package step 1 (exact match, 17 for 17 -- D2's own prose
// mislabels the count as "16," a label error, not a set mismatch).
const EXPECTED_DELETE_POLICIES = [
  'boq_items_delete',
  'boq_sessions_delete',
  'hindrances_delete',
  'invoices_delete',
  'project_members_delete',
  'projects_delete',
  'ra_bill_payments_delete',
  'ra_bills_delete',
  'safety_incidents_delete',
  'tender_chat_messages_delete',
  'tender_chat_sessions_delete',
  'tender_document_chunks_delete',
  'tender_documents_delete',
  'tenders_delete',
  'vendor_invoices_delete',
  'vendors_delete',
  'whatsapp_sessions_delete',
]

describe('migration 047 — static source guard (no live database touched)', () => {
  const sql = read047()
  const strippedSql = stripSqlComments(sql)

  it('discovers at least the 32 tables this migration was authored against (a smaller live count would mean a table this file should cover was missed)', () => {
    const tables = discoverPublicTables()
    expect(tables.length).toBeGreaterThanOrEqual(32)
  })

  it('every table in schema public has an explicit REVOKE ... FROM anon, authenticated covering TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, and DELETE', () => {
    const tables = discoverPublicTables()
    const missing: string[] = []
    for (const table of tables) {
      const re = new RegExp(
        `REVOKE\\s+TRUNCATE,\\s*TRIGGER,\\s*REFERENCES,\\s*MAINTAIN,\\s*DELETE\\s+ON\\s+public\\.${table}\\s+FROM\\s+anon,\\s*authenticated;`,
        'i',
      )
      if (!re.test(strippedSql)) missing.push(table)
    }
    expect(missing).toEqual([])
  })

  it('drops exactly the 17 policies D2 names, no more, no fewer', () => {
    const dropRe = /DROP\s+POLICY\s+(\w+)\s+ON\s+public\.\w+;/gi
    const dropped = [...strippedSql.matchAll(dropRe)].map((m) => m[1]).sort()
    expect(dropped).toEqual([...EXPECTED_DELETE_POLICIES].sort())
  })

  it('never touches service_role (D6) — no REVOKE or GRANT statement in the forward migration names service_role', () => {
    const forwardOnly = strippedSql.split(/^-- DOWN/im)[0]
    expect(forwardOnly).not.toMatch(/service_role/i)
  })

  it('never touches SELECT, INSERT, or UPDATE (D5) — the forward migration privilege lists are limited to TRUNCATE/TRIGGER/REFERENCES/MAINTAIN/DELETE', () => {
    const forwardOnly = strippedSql.split(/^-- DOWN/im)[0]
    const revokeLines = forwardOnly.match(/REVOKE\s+[^;]+;/gi) ?? []
    for (const line of revokeLines) {
      expect(line).not.toMatch(/\bSELECT\b/i)
      expect(line).not.toMatch(/\bINSERT\b/i)
      expect(line).not.toMatch(/\bUPDATE\b/i)
    }
  })

  it('contains a final DO block that RAISEs EXCEPTION on a remaining grant or a remaining polcmd \'d\' policy — the live, DB-level half of D4', () => {
    expect(strippedSql).toMatch(/RAISE\s+EXCEPTION\s+'migration 047:.*grant/i)
    expect(strippedSql).toMatch(/RAISE\s+EXCEPTION\s+'migration 047:.*polic/i)
    expect(strippedSql).toMatch(/polcmd\s*=\s*'d'/i)
  })

  it('D3 scopes ALTER DEFAULT PRIVILEGES to FOR ROLE postgres only, tables only — never supabase_admin, never sequences, never functions', () => {
    const forwardOnly = strippedSql.split(/^-- DOWN/im)[0]
    const defaultPrivLines = forwardOnly.match(/ALTER\s+DEFAULT\s+PRIVILEGES[^;]+;/gi) ?? []
    expect(defaultPrivLines.length).toBeGreaterThan(0)
    for (const line of defaultPrivLines) {
      expect(line).toMatch(/FOR ROLE postgres\b/i)
      expect(line).not.toMatch(/supabase_admin/i)
      expect(line).toMatch(/ON TABLES\b/i)
      expect(line).not.toMatch(/ON SEQUENCES\b/i)
      expect(line).not.toMatch(/ON FUNCTIONS\b/i)
    }
  })
})
