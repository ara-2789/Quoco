#!/usr/bin/env node
// Guard (a) for the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md). Built in batch 1,
// before any fixture family migrates -- named ahead of time so it exists,
// is proven correct, and is already wired into CI the moment a family's
// old literal actually needs retiring, rather than being built under
// pressure after the first straggler incident.
//
// THE FAILURE THIS CATCHES: a fixture family "migrates" to a per-run
// derived identifier, but one call site -- a copy-paste, a test that
// hardcodes the tenant id as a raw string instead of importing the
// constant, a file nobody thought to touch -- keeps resolving to the OLD,
// shared, fixed literal. The suite still goes green, because its own
// assertions are scoped by whatever identifier that straggler actually
// used; it silently keeps testing against the old shared row instead of
// this run's own isolated one. A green suite cannot detect this by
// construction -- only a mechanical scan for the retired literal itself
// can.
//
// MECHANISM: scripts/retired-fixture-literals.json lists every literal
// string a fixture family's migration has retired (empty until a family
// actually migrates -- batch 1 ships this file empty). This script scans
// every .ts/.tsx file under test/ (comments stripped, so a literal
// mentioned in an explanatory comment about history does not trip this --
// only live code references do) and fails, listing every hit, if any
// retired literal still appears anywhere.
//
// NO EXCEPTIONS MECHANISM -- deliberately, same reasoning as
// lint-migrations.mjs's own shared-fixture-fk-coverage rule (Rule 9): a
// straggler literal is a live isolation hazard, not a judgment call. A
// finding means fix the call site, not add it to an exceptions list (no
// such list exists for this rule).

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const TEST_DIR = join(REPO_ROOT, 'test')
const RETIRED_PATH = join(__dirname, 'retired-fixture-literals.json')
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx'])

// Strip `//` line comments and `/* */` block comments. TypeScript, unlike
// lint-migrations.mjs's SQL files, so a different comment grammar.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function walkTestFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkTestFiles(full))
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

function main() {
  const retired = JSON.parse(readFileSync(RETIRED_PATH, 'utf8'))

  if (retired.length === 0) {
    console.log('lint-retired-fixture-literals: clean (0 retired literals registered -- no family migrated yet).')
    return
  }

  const files = walkTestFiles(TEST_DIR)
  const violations = []

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const source = stripComments(raw)
    for (const entry of retired) {
      if (source.includes(entry.literal)) {
        violations.push({
          file: relative(REPO_ROOT, file),
          literal: entry.literal,
          label: entry.label,
        })
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `lint-retired-fixture-literals: ${violations.length} retired literal(s) still referenced under test/:\n`,
    )
    for (const v of violations) {
      console.error(`  ${v.file}: "${v.literal}" (${v.label})`)
    }
    console.error(
      '\nThis has no exceptions mechanism. Every one of these call sites resolves to a shared, retired ' +
        'identifier instead of this run\'s own isolated one -- fix the call site (import the real constant / ' +
        'derived helper instead of the literal), do not exempt it.',
    )
    process.exit(1)
  }

  console.log(
    `lint-retired-fixture-literals: clean (${retired.length} retired literal(s) checked, 0 stragglers under test/).`,
  )
}

main()
