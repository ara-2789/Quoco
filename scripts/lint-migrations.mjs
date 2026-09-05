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
//
// HELD MIGRATIONS, ADDED 2026-08-31 (external review, migration 034's own
// renumbering incident — 030 was drafted, held in docs/reviews/, and sat
// unnoticed while 030/031/032/033 were each claimed by other work, six days
// and three numbers out of date before anyone caught it). Every rule above
// now ALSO runs against docs/reviews/*.sql files matching the migration
// filename shape (`^\d+_.*\.sql$`) — a held-but-unapplied migration is not
// exempt from any of these defect classes just because it hasn't shipped
// yet; scanning only supabase/migrations/ is exactly the sweep-scope limit
// that let 034's own service_role grant gap sit undetected through three
// prior sweeps (see CLAUDE.md's own standing rule on this). Two new checks
// specific to held files:
//
//   unique-migration-prefix (WIDENED, not a new rule) — now checks the
//     UNION of applied + held filenames, not just applied ones. A held file
//     colliding with an ALREADY-APPLIED number (030's own defect) and two
//     held files colliding with EACH OTHER are now the same check.
//   held-migration-reservation-required (NEW, rule 8) — every held file
//     must have a matching entry in scripts/migration-number-
//     reservations.json (number + exact claimedBy path). Formalises what
//     CLAUDE.md §3's own prose did once, informally, for migration 031
//     ("already informally reserved by CLAUDE.md §3's own text" —
//     docs/reviews/session-transition-lock-wait-flake.md) — that worked only
//     because a later author happened to read the right paragraph before
//     numbering their own file. This rule makes the same protection
//     mechanical instead of dependent on someone reading the right prose.
//
// Held-directory files are identified in every violation by their path
// RELATIVE TO THE REPO ROOT (e.g. "docs/reviews/026_dpr_generation_
// stale.sql"), never a bare filename — applied-directory files keep their
// existing bare-filename identifiers, unchanged, for exceptions-file
// backward compatibility. Qualification is necessary, not cosmetic: two
// real files in this repo share an identical basename across the two
// directories today (`028_dprs_engineer_id_option_a.sql`, both a live
// migration and a historical, faithful-record copy kept in docs/reviews/ for
// the record) — a bare-name-only identifier could not tell them apart.
//
// NOT EVERY docs/reviews/*.sql FILE IS A LIVE COLLISION RISK, NAMED SO THE
// EXCEPTIONS BELOW AREN'T MISREAD AS NOISE. Two shapes exist in that
// directory today that are NOT "pending, will be promoted under this
// number" the way 026/034 are: a historical copy of an already-applied
// migration kept for the record (028_dprs_engineer_id_option_a.sql), and a
// permanently-rejected design alternative that will never apply under any
// number (028_dprs_engineer_id_option_b.sql). Both correctly trip the
// widened unique-migration-prefix check (028 is genuinely taken) and the
// new reservation-required check (neither will ever be reserved, because
// neither is pending) — exempted below with the reason stated, per this
// script's own no-file-wide-exemptions discipline, not silently excluded
// from the scan.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const MIGDIR = join(REPO_ROOT, 'supabase', 'migrations')
const HELDDIR = join(REPO_ROOT, 'docs', 'reviews')
const EXCEPTIONS_PATH = join(__dirname, 'migration-lint-exceptions.json')
const RESERVATIONS_PATH = join(__dirname, 'migration-number-reservations.json')
const FK_COVERAGE_PATH = join(__dirname, 'shared-fixture-fk-coverage.json')
const MIGRATION_FILENAME_RE = /^\d+_.*\.sql$/

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
// Rule 9 — shared-fixture-fk-coverage
// ---------------------------------------------------------------------------
// The 2026-09-05 FK-cascade incident (docs/reviews/admin-merge-retrospective-
// 2026-09-05.md): test/helpers/db.ts's removeMorningFixtures()/
// removeTestTenant() delete the shared fixture engineer (a users row) / the
// shared fixture tenant (a tenants row) without first clearing every OTHER
// table that still references them without ON DELETE CASCADE. A stray
// daily_logs row (a table nobody had widened cleanup for) blocked the users
// delete and cascaded into 16 failing test files in one CI run.
//
// The fix is an explicit, hand-maintained coverage list
// (scripts/shared-fixture-fk-coverage.json) that test/helpers/db.ts's
// sweepSharedFixtureReferences() reads and acts on before either delete.
// THIS RULE is what keeps that list honest: it scans every migration file
// for a foreign key referencing users(id) or tenants(id) that does NOT
// carry ON DELETE CASCADE (a cascading FK self-cleans — nothing to sweep)
// and requires a matching entry in the coverage file.
//
// UNLIKE EVERY OTHER RULE IN THIS FILE, THIS ONE HAS NO EXCEPTIONS
// MECHANISM — deliberately. migration-lint-exceptions.json exists for
// intentional trade-offs a human has judged acceptable; an unswept table
// here is a live-cascade risk, not a judgment call, so a violation is
// unconditionally fatal (see main() below — this rule's output is never
// filtered against the exceptions set). A finding means: add the table to
// the coverage file and teach the sweep function to act on it, not exempt it.
//
// SCOPE, STATED PLAINLY: this only checks the migration-file TEXT for the
// FK shape (same limitation as every other rule here) — it cannot verify
// the coverage file's `action` (delete vs null) is the right choice for a
// NOT NULL column, or that sweepSharedFixtureReferences() actually runs
// against a real database correctly. That's proven by the test suite
// itself running green, not by this static check.
function tableForOffset(sql, offset) {
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi
  let m
  while ((m = createRe.exec(sql))) {
    if (m.index > offset) break
    const nameEnd = m.index + m[0].length
    const block = extractParenBlock(sql, nameEnd)
    if (!block) continue
    if (offset >= nameEnd && offset < block.endIdx) return bareName(m[1])
  }
  // Not inside any CREATE TABLE body — fall back to the nearest ALTER TABLE
  // header in the same statement (no ';' between it and this offset). Every
  // FK this codebase adds outside a CREATE TABLE is an
  // `ALTER TABLE x ADD COLUMN|ADD CONSTRAINT ...` immediately before it.
  const beforeText = sql.slice(0, offset)
  const lastSemi = beforeText.lastIndexOf(';')
  const stmt = sql.slice(lastSemi + 1, offset + 1)
  const alterM = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/i.exec(stmt)
  return alterM ? bareName(alterM[1]) : null
}

function ruleSharedFixtureFkCoverage(file, sql, coverage) {
  const found = []

  // Column-level: `col_name UUID ... REFERENCES [public.]parent(id) [ON DELETE ...]`
  // — matches both a CREATE TABLE body line and an ALTER TABLE ADD COLUMN
  // statement; not anchored to line-start since ADD COLUMN precedes the
  // column name on the same line.
  const colFkRe =
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+UUID\b[^,;\n]*?REFERENCES\s+(?:public\.)?"?(users|tenants)"?\s*\(\s*id\s*\)([^,;\n]*)/gi
  let m
  while ((m = colFkRe.exec(sql))) {
    const [, column, parent, trailing] = m
    if (/ON\s+DELETE\s+CASCADE/i.test(trailing)) continue
    const table = tableForOffset(sql, m.index)
    if (table) found.push({ table, column, parent })
  }

  // Composite / out-of-line: `[CONSTRAINT name] FOREIGN KEY (cols) REFERENCES
  // [public.]parent (cols) [ON UPDATE ...] [ON DELETE ...]` — inside a
  // CREATE TABLE body or a standalone ALTER TABLE ADD CONSTRAINT. The local
  // column that maps to the parent's own `id` is always the FIRST column in
  // the list, by this codebase's own composite-FK convention (id is always
  // listed first on the parent side too).
  const fkClauseRe =
    /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:public\.)?"?(users|tenants)"?\s*\(([^)]+)\)([^;,)]*)/gi
  while ((m = fkClauseRe.exec(sql))) {
    const [, localCols, parent, , trailing] = m
    if (/ON\s+DELETE\s+CASCADE/i.test(trailing)) continue
    const table = tableForOffset(sql, m.index)
    const column = localCols.split(',')[0].trim()
    if (table) found.push({ table, column, parent })
  }

  const violations = []
  for (const { table, column, parent } of found) {
    const covered = coverage.some((c) => c.table === table && c.column === column && c.parent === parent)
    if (!covered) {
      violations.push({ file, object: `${table}.${column} -> ${parent}`, rule: 'shared-fixture-fk-coverage' })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 7 — unique-migration-prefix
// WIDENED 2026-08-31 (held migrations, see file header): `entries` is now
// the UNION of applied + held files, each as { name, qualified } — `name`
// is the bare filename (what the number prefix is read from; applied and
// held files can share a bare name, see the 028 note in the file header),
// `qualified` is what gets reported (bare for applied, `docs/reviews/...`
// for held). A held file colliding with an applied number and two held
// files colliding with each other are now the same check, not two.
// ---------------------------------------------------------------------------
function ruleUniqueMigrationPrefix(entries) {
  const byPrefix = new Map()
  for (const e of entries) {
    const m = /^(\d+)_/.exec(e.name)
    if (!m) continue
    const list = byPrefix.get(m[1]) ?? []
    list.push(e)
    byPrefix.set(m[1], list)
  }
  const violations = []
  for (const [prefix, list] of byPrefix) {
    if (list.length > 1) {
      for (const e of list) {
        violations.push({ file: e.qualified, object: `duplicate-prefix-${prefix}`, rule: 'unique-migration-prefix' })
      }
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Rule 8 — held-migration-reservation-required (NEW, 2026-08-31)
// ---------------------------------------------------------------------------
// Every held file (docs/reviews/*.sql matching the migration filename
// shape) must have a matching entry in scripts/migration-number-
// reservations.json: the entry's `number` must equal the file's own prefix,
// AND its `claimedBy` must equal this file's qualified path exactly — a
// missing entry, or one pointing at a DIFFERENT file than the one actually
// using that number, both fail. This is what makes a plan-time reservation
// (CLAUDE.md §3's own informal "031 reserved" prose, once) mechanically
// checked instead of dependent on a later author reading the right
// paragraph before numbering their own file.
function ruleHeldMigrationReservationRequired(heldEntries, reservations) {
  const byNumber = new Map(reservations.map((r) => [r.number, r]))
  const violations = []
  for (const e of heldEntries) {
    const m = /^(\d+)_/.exec(e.name)
    if (!m) continue
    const number = m[1]
    const entry = byNumber.get(number)
    if (!entry) {
      violations.push({ file: e.qualified, object: `unreserved-${number}`, rule: 'held-migration-reservation-required' })
    } else if (entry.claimedBy !== e.qualified) {
      violations.push({ file: e.qualified, object: `reservation-mismatch-${number}`, rule: 'held-migration-reservation-required' })
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

// scripts/migration-number-reservations.json — {number, claimedBy, note}
// triples. Protects a number claimed at PLAN TIME, before any file exists —
// see the file header (HELD MIGRATIONS) for why. `note` is required, same
// discipline as the exceptions file's own `reason` field: a reservation
// with no explanation is exactly the kind of thing a later reader can't
// evaluate.
function loadReservations() {
  const raw = JSON.parse(readFileSync(RESERVATIONS_PATH, 'utf8'))
  for (const r of raw) {
    if (!r.number || !r.claimedBy || !r.note) {
      throw new Error(
        `migration-lint: malformed reservation entry (needs number, claimedBy, note): ${JSON.stringify(r)}`,
      )
    }
  }
  return raw
}

// Reads a directory's own migration-shaped .sql files and returns
// { name, qualified } entries — `name` for prefix matching, `qualified` for
// reporting. `qualify` is identity for the applied directory (bare
// filenames, backward-compatible with the existing exceptions file) and
// repo-root-relative for the held directory (disambiguates the 028 same-
// basename case, see the file header).
function listMigrationEntries(dir, qualify) {
  return readdirSync(dir)
    .filter((f) => MIGRATION_FILENAME_RE.test(f))
    .sort()
    .map((name) => ({ name, qualified: qualify(name) }))
}

function main() {
  // Applied: bare-filename identity, unchanged (exceptions-file backward
  // compatibility). Held: repo-root-relative identity (the 028 same-
  // basename case — see file header).
  const appliedEntries = listMigrationEntries(MIGDIR, (name) => name)
  const heldEntries = listMigrationEntries(HELDDIR, (name) => relative(REPO_ROOT, join(HELDDIR, name)))
  const exceptions = loadExceptions()
  const reservations = loadReservations()
  const fkCoverage = JSON.parse(readFileSync(FK_COVERAGE_PATH, 'utf8'))

  const violations = []
  const fkCoverageViolations = []
  for (const [dir, entries] of [[MIGDIR, appliedEntries], [HELDDIR, heldEntries]]) {
    for (const { name, qualified } of entries) {
      const raw = readFileSync(join(dir, name), 'utf8')
      const sql = stripComments(raw)
      const blocks = findCreateTableBlocks(sql)
      const alterColumns = findAlterAddColumns(sql)

      violations.push(...ruleOrphanSecurityDefiner(qualified, sql))
      violations.push(...ruleTenantIdRequired(qualified, blocks))
      violations.push(...ruleRlsRequired(qualified, sql, blocks))
      violations.push(...ruleMoneyColumnPrecision(qualified, blocks, alterColumns))
      violations.push(...ruleStatusColumnShape(qualified, sql, blocks))
      violations.push(...ruleServiceRoleGrantRequired(qualified, sql, blocks))
      fkCoverageViolations.push(...ruleSharedFixtureFkCoverage(qualified, sql, fkCoverage))
    }
  }
  violations.push(...ruleUniqueMigrationPrefix([...appliedEntries, ...heldEntries]))
  violations.push(...ruleHeldMigrationReservationRequired(heldEntries, reservations))

  // --json: dump every RAW violation (pre-exceptions-filter) as JSON, for
  // building/auditing scripts/migration-lint-exceptions.json itself — never
  // used by CI, only by a human curating that file.
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify([...violations, ...fkCoverageViolations], null, 2))
    return
  }

  // shared-fixture-fk-coverage has NO exceptions mechanism — see the rule's
  // own header for why. Any finding here is fatal on its own, checked
  // before the exemptible violations below.
  if (fkCoverageViolations.length > 0) {
    console.error(
      `migration-lint: ${fkCoverageViolations.length} table(s) with a non-CASCADE FK to ` +
        `users(id)/tenants(id) missing from scripts/shared-fixture-fk-coverage.json:\n`,
    )
    for (const v of fkCoverageViolations) {
      console.error(`  ${v.file}: ${v.object}  [${v.rule}]`)
    }
    console.error(
      '\nThis has no exceptions mechanism. Add the table to ' +
        'scripts/shared-fixture-fk-coverage.json and teach ' +
        'sweepSharedFixtureReferences() (test/helpers/db.ts) to act on the new entry — ' +
        'see docs/reviews/admin-merge-retrospective-2026-09-05.md for why.',
    )
    process.exit(1)
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
