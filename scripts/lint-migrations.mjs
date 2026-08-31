#!/usr/bin/env node
// Stage 2 of the process-hardening work order's P2 (CI gates). Text-only
// parse of supabase/migrations/*.sql — no DB connection, no `supabase` CLI.
// Seven rules, chosen because each one is a real incident class this repo
// has already lived through once:
//
//   no-orphan-security-definer  — the 020 incident (seven functions shipped
//                                  with PostgreSQL's default PUBLIC EXECUTE)
//   tenant-id-required          — CLAUDE.md §4's core multi-tenancy rule
//   rls-required                — RLS must be turned on, not just intended
//   money-column-precision      — CLAUDE.md §6's DECIMAL(12,2) rule
//   status-column-shape         — CLAUDE.md §6's TEXT+CHECK rule, no ENUMs
//   service-role-grant-required — the 2026-08-26 finding (dpr_versions,
//                                  and 031's own first draft): the same
//                                  020 incident, one object class over —
//                                  see Rule 6's own header for what this
//                                  can and cannot catch
//   unique-migration-prefix     — two files racing for the same number
//
// Every violation found is checked against scripts/migration-lint-exceptions.json
// before being reported. Exceptions are keyed as NARROW (file, object, rule)
// triples — never file-wide, never rule-wide. A new SECURITY DEFINER function
// added to an old, already-exempted file is a DIFFERENT object, so it is a
// DIFFERENT key, so it is NOT exempted. That is the one property the
// exceptions file exists to guarantee; see docs/reviews/p2-ci-gates.md §3 for
// the investigation that produced the six rules and the 50 starting
// exceptions, including two probe-script bugs that were found and fixed
// before this file was written (a DECIMAL comma-truncation bug, and a bare
// `value` substring match that caught JSONB audit-log columns).

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const MIGDIR = join(REPO_ROOT, 'supabase', 'migrations')
const EXCEPTIONS_PATH = join(__dirname, 'migration-lint-exceptions.json')

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

// Strip `-- ...` line comments. None of these files use /* */ block comments
// for SQL (verified: zero matches across 001-022), so that's not handled.
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

function bareName(qualified) {
  return qualified.split('.').pop().replace(/^"|"$/g, '')
}

// Extract the contents of the top-level parenthesized block starting at the
// first `(` at/after `fromIdx`, using a depth counter — NOT a regex — so
// nested parens (CHECK(...), DEFAULT gen_random_uuid(), etc.) don't
// terminate the block early.
function extractParenBlock(text, fromIdx) {
  let i = text.indexOf('(', fromIdx)
  if (i === -1) return null
  const start = i + 1
  let depth = 1
  i++
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    i++
  }
  if (depth !== 0) return null
  return { body: text.slice(start, i - 1), endIdx: i }
}

// One entry per CREATE TABLE (skips `CREATE TABLE x AS SELECT ...`, which
// has no column-list paren immediately after the name).
function findCreateTableBlocks(sql) {
  const blocks = []
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi
  let m
  while ((m = re.exec(sql))) {
    const afterName = sql.slice(m.index + m[0].length, m.index + m[0].length + 50)
    const parenOffset = afterName.indexOf('(')
    if (parenOffset === -1 || /^\s*$/.test(afterName.slice(0, parenOffset)) === false) continue
    const block = extractParenBlock(sql, m.index + m[0].length)
    if (!block) continue
    blocks.push({ table: bareName(m[1]), body: block.body })
  }
  return blocks
}

// table.column pairs added later via ALTER TABLE ... ADD COLUMN (so a money
// column added outside its original CREATE TABLE is still checked).
function findAlterAddColumns(sql) {
  const out = []
  const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)\s+ADD\s+COLUMN\s+([a-zA-Z0-9_"]+)\s+([A-Za-z][A-Za-z0-9_ (),]*?)(?:;|,|\n)/gi
  let m
  while ((m = re.exec(sql))) {
    out.push({ table: bareName(m[1]), column: bareName(m[2]), type: m[3].trim() })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rule 1 — no-orphan-security-definer
// ---------------------------------------------------------------------------
// A function is only scanned for SECURITY DEFINER within its OWN header —
// from `CREATE [OR REPLACE] FUNCTION name(...)` to that function's
// `AS $$`/`AS $tag$` body marker — never a fixed character window, which
// previously produced a false positive by reading the NEXT function's
// SECURITY DEFINER in a probe script (quoco_same_ist_day, migration 012).
function ruleOrphanSecurityDefiner(file, sql) {
  const violations = []
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_."]+)\s*\(/gi
  let m
  while ((m = re.exec(sql))) {
    const name = bareName(m[1])
    const asMatch = /AS\s+\$(\w*)\$/i.exec(sql.slice(m.index))
    if (!asMatch) continue
    const header = sql.slice(m.index, m.index + asMatch.index)
    if (!/SECURITY\s+DEFINER/i.test(header)) continue

    const hasRevoke = new RegExp(
      `REVOKE\\s+[^;]*ON\\s+FUNCTION\\s+[^;]*\\b${name}\\b[^;]*FROM\\s+PUBLIC`,
      'i',
    ).test(sql) || new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+[^;]*\\b${name}\\b`,
      'i',
    ).test(sql)
    const hasGrant = new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+[^;]*\\b${name}\\b`,
      'i',
    ).test(sql)

    if (!hasRevoke || !hasGrant) {
      violations.push({ file, object: name, rule: 'no-orphan-security-definer' })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rules 2 & 3 — tenant-id-required, rls-required
// ---------------------------------------------------------------------------
function ruleTenantIdRequired(file, blocks) {
  return blocks
    .filter((b) => !/\btenant_id\b/i.test(b.body))
    .map((b) => ({ file, object: b.table, rule: 'tenant-id-required' }))
}

function ruleRlsRequired(file, sql, blocks) {
  const violations = []
  for (const b of blocks) {
    const hasRls = new RegExp(
      `ALTER\\s+TABLE\\s+[^;]*\\b${b.table}\\b[^;]*ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i',
    ).test(sql)
    if (!hasRls) violations.push({ file, object: b.table, rule: 'rls-required' })
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 4 — money-column-precision
// ---------------------------------------------------------------------------
// Scoped to columns found inside a CREATE TABLE block or a later ALTER TABLE
// ADD COLUMN — never a bare whole-file substring scan, which previously
// caught JSONB audit-log columns (old_value/new_value, migration 019) whose
// names merely contained "value". A candidate is skipped immediately unless
// its type looks numeric, before the name pattern is even consulted.
//
// Name matching is TOKEN-EXACT (split on `_`, check for an exact-match
// token), not substring or \b-bounded regex — \b treats `_` as a word
// character, so `\bprice\b` matches neither "price" inside "priced_items"
// NOR (the case that actually matters) "rate" inside "final_rate", since
// snake_case names have no true word boundary at an internal underscore
// either way. Token-exact matching is the only one of the three that gets
// both right: it rejects "priced_items" (found as a real false positive
// while building the exceptions list below — INTEGER, a count, not money)
// and still catches "final_rate" (the "rate" token, standalone).
const MONEY_WORDS = new Set(['amount', 'cost', 'rate', 'price', 'value', 'payment', 'turnover'])
const NUMERIC_TYPE = /^(DECIMAL|NUMERIC|INTEGER|INT|BIGINT|SMALLINT|REAL|FLOAT|MONEY)\b/i
const REQUIRED_PRECISION = /^(?:DECIMAL|NUMERIC)\(\s*12\s*,\s*2\s*\)/i

function hasMoneyToken(colName) {
  return colName.toLowerCase().split('_').some((tok) => MONEY_WORDS.has(tok))
}

function checkMoneyColumn(colName, colType) {
  if (!hasMoneyToken(colName)) return false
  const typeNorm = colType.replace(/\s+/g, ' ').trim().toUpperCase()
  if (!NUMERIC_TYPE.test(typeNorm)) return false // JSONB/TEXT/etc: not a money column
  return !REQUIRED_PRECISION.test(typeNorm)
}

function ruleMoneyColumnPrecision(file, blocks, alterColumns) {
  const violations = []
  const colLineRe = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+([A-Z][A-Za-z0-9_ (),]*)/gim
  for (const b of blocks) {
    let m
    colLineRe.lastIndex = 0
    while ((m = colLineRe.exec(b.body))) {
      const [, colName, colType] = m
      if (checkMoneyColumn(colName, colType)) {
        violations.push({ file, object: `${b.table}.${colName}`, rule: 'money-column-precision' })
      }
    }
  }
  for (const { table, column, type } of alterColumns) {
    if (checkMoneyColumn(column, type)) {
      violations.push({ file, object: `${table}.${column}`, rule: 'money-column-precision' })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 5 — status-column-shape (no ENUM types; status columns need TEXT+CHECK)
// ---------------------------------------------------------------------------
function ruleStatusColumnShape(file, sql, blocks) {
  const violations = []

  const enumRe = /CREATE\s+TYPE\s+([a-zA-Z0-9_."]+)\s+AS\s+ENUM/gi
  let m
  while ((m = enumRe.exec(sql))) {
    violations.push({ file, object: bareName(m[1]), rule: 'status-column-shape' })
  }

  const statusColRe = /^\s*(\w*status\w*)\s+([A-Z][A-Za-z0-9_ ]*)/gim
  for (const b of blocks) {
    let sm
    statusColRe.lastIndex = 0
    while ((sm = statusColRe.exec(b.body))) {
      const [full, colName, colType] = sm
      const typeNorm = colType.replace(/\s+/g, ' ').trim().toUpperCase()
      const object = `${b.table}.${colName}`
      if (!typeNorm.startsWith('TEXT')) {
        violations.push({ file, object, rule: 'status-column-shape' })
        continue
      }
      const nearby = b.body.slice(sm.index + full.length, sm.index + full.length + 400)
      if (!/CHECK/i.test(nearby)) {
        violations.push({ file, object, rule: 'status-column-shape' })
      }
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 6 — service-role-grant-required
// ---------------------------------------------------------------------------
// The service_role table-grant gap, mechanised: `docs/reviews/
// service-role-table-grants-gap.md` and CLAUDE.md §0 (2026-08-26).
// Supabase's project-level default ACL grants `service_role` ALL
// privileges on every new public-schema table automatically — a
// table-level REVOKE that names only `anon`/`authenticated` (the two
// roles a migration author naturally thinks about, since those are what
// PostgREST exposes externally) leaves that default fully in place.
// `service_role` bypasses RLS by design, so for this role the grant layer
// is the ONLY defense. This rule requires a REVOKE naming `service_role`,
// somewhere in the file, for every table the file CREATEs.
//
// WHAT THIS RULE DOES NOT AND CANNOT CATCH — recorded here, not left
// implicit. This is a TEXTUAL check: it confirms `service_role` is named
// in SOME revoke targeting the table, not that the resulting privilege
// set is actually correct (a `REVOKE SELECT ON t FROM ... service_role`
// would satisfy this regex while leaving DELETE/TRUNCATE untouched — that
// gap is caught only by an actual `has_table_privilege` probe against a
// real database, never by parsing SQL text). More importantly, this rule
// cannot mechanise the SECOND standing rule the same finding produced —
// CLAUDE.md §7's REHEARSAL REQUIREMENT, that a new table's test-db
// rehearsal must probe `service_role`'s NEGATIVE capabilities (DELETE,
// TRUNCATE) directly against a live database. That requirement lives in
// REHEARSAL DESIGN — what a human writes into a review package's own
// test suite — not in migration FILE TEXT, so no static parse of the .sql
// file can verify it. A file can pass this rule (REVOKE mentions
// service_role) while its author never actually ran the negative-capability
// probe the rehearsal rule requires; the two rules are independent and
// both are needed. This rule closes the half of the finding that CAN be
// mechanised; the other half stays a human, per-migration discipline.
function ruleServiceRoleGrantRequired(file, sql, blocks) {
  const violations = []
  for (const b of blocks) {
    const hasServiceRoleRevoke = new RegExp(
      `REVOKE\\s+[^;]*ON\\s+(?:TABLE\\s+)?(?:public\\.)?"?${b.table}"?\\s+FROM\\s+[^;]*\\bservice_role\\b`,
      'i',
    ).test(sql)
    if (!hasServiceRoleRevoke) {
      violations.push({ file, object: b.table, rule: 'service-role-grant-required' })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 7 — unique-migration-prefix
// ---------------------------------------------------------------------------
function ruleUniqueMigrationPrefix(files) {
  const byPrefix = new Map()
  for (const f of files) {
    const m = /^(\d+)_/.exec(f)
    if (!m) continue
    const list = byPrefix.get(m[1]) ?? []
    list.push(f)
    byPrefix.set(m[1], list)
  }
  const violations = []
  for (const [prefix, list] of byPrefix) {
    if (list.length > 1) {
      for (const f of list) {
        violations.push({ file: f, object: `duplicate-prefix-${prefix}`, rule: 'unique-migration-prefix' })
      }
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function loadExceptions() {
  const raw = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'))
  const set = new Set()
  for (const e of raw) {
    if (!e.file || !e.object || !e.rule || !e.reason) {
      throw new Error(
        `migration-lint: malformed exception entry (needs file, object, rule, reason): ${JSON.stringify(e)}`,
      )
    }
    set.add(`${e.file}::${e.object}::${e.rule}`)
  }
  return set
}

function main() {
  const files = readdirSync(MIGDIR).filter((f) => f.endsWith('.sql')).sort()
  const exceptions = loadExceptions()

  const violations = []
  for (const file of files) {
    const raw = readFileSync(join(MIGDIR, file), 'utf8')
    const sql = stripComments(raw)
    const blocks = findCreateTableBlocks(sql)
    const alterColumns = findAlterAddColumns(sql)

    violations.push(...ruleOrphanSecurityDefiner(file, sql))
    violations.push(...ruleTenantIdRequired(file, blocks))
    violations.push(...ruleRlsRequired(file, sql, blocks))
    violations.push(...ruleMoneyColumnPrecision(file, blocks, alterColumns))
    violations.push(...ruleStatusColumnShape(file, sql, blocks))
    violations.push(...ruleServiceRoleGrantRequired(file, sql, blocks))
  }
  violations.push(...ruleUniqueMigrationPrefix(files))

  // --json: dump every RAW violation (pre-exceptions-filter) as JSON, for
  // building/auditing scripts/migration-lint-exceptions.json itself — never
  // used by CI, only by a human curating that file.
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(violations, null, 2))
    return
  }

  const unexempted = violations.filter((v) => !exceptions.has(`${v.file}::${v.object}::${v.rule}`))

  if (unexempted.length > 0) {
    console.error(
      `migration-lint: ${unexempted.length} violation(s) not covered by scripts/migration-lint-exceptions.json:\n`,
    )
    for (const v of unexempted) {
      console.error(`  ${v.file}: ${v.object}  [${v.rule}]`)
    }
    console.error(
      '\nEach violation needs either a fix, or a new (file, object, rule) entry in ' +
        'scripts/migration-lint-exceptions.json with a reason — never a file-wide ' +
        'or rule-wide exemption.',
    )
    process.exit(1)
  }

  console.log(`migration-lint: clean. ${violations.length} known violation(s), all exempted.`)
}

main()
