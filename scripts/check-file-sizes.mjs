#!/usr/bin/env node
// File-size lint — CLAUDE.md §0's "FILE SIZE LIMITS" standing rule
// (2026-08-22). Origin: CLAUDE.md reached 167,825 chars before anyone
// noticed; its own effective read window silently truncates past roughly
// 150,000 chars, so the last ~20,000 (11 incident blocks) had been out of
// context for an unknown period, and two open findings existed only there
// (rescued into docs/reviews/2026-08-13-flow-start-mystery.md and
// docs/plans/flow-migration-rescoping-plan.md; full audit in
// docs/reviews/claude-md-rule-inventory-2026-08-22.md). A rule that only
// exists as prose nobody checks is exactly how this happened — this script
// is what makes the size visible before it's a crisis, not just at the
// threshold.
//
// Byte length (Buffer.byteLength, UTF-8) is used throughout, matching
// `wc -c` — the tool that first measured CLAUDE.md and the number the
// standing rule itself cites (167,825) — not JS string .length, which
// undercounts multi-byte characters (em dashes, curly quotes) that this
// project's docs use heavily.
//
// Two tiers, deliberately different (CLAUDE.md §0's own rule, verbatim):
//   - CLAUDE.md: warn at 120,000, HARD FAIL at 140,000 — it's read into
//     every session's context, so a silent tail-drop there is the actual
//     incident this script exists to prevent.
//   - Every other docs/**/*.md file: warn at 120,000, never a hard fail —
//     docs/reviews/ and docs/plans/ are meant to grow; the point is
//     visibility, not a cap.
//
// Wired into both .githooks/pre-commit (fast local gate, catches it before
// a commit lands) and .github/workflows/ci.yml's "File Size Lint" job
// (durable backstop — runs even if the local hook is bypassed with
// --no-verify or never installed on a given machine). Same script, same
// thresholds, both places — one source of truth for the number.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const CLAUDE_MD_PATH = join(REPO_ROOT, 'CLAUDE.md')
const DOCS_DIR = join(REPO_ROOT, 'docs')

const CLAUDE_MD_WARN = 120_000
const CLAUDE_MD_FAIL = 140_000
const DOCS_WARN = 120_000

function byteLength(path) {
  return Buffer.byteLength(readFileSync(path, 'utf8'), 'utf8')
}

function relPath(path) {
  return path.slice(REPO_ROOT.length + 1)
}

// Recursive, no dependency — docs/ has no node_modules-sized subtree to
// worry about skipping.
function walkMarkdown(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function fmt(n) {
  return n.toLocaleString('en-US')
}

function main() {
  let hardFail = false

  const claudeSize = byteLength(CLAUDE_MD_PATH)
  if (claudeSize >= CLAUDE_MD_FAIL) {
    console.error(
      `file-size-lint: FAIL  CLAUDE.md  ${fmt(claudeSize)} chars ` +
        `(>= ${fmt(CLAUDE_MD_FAIL)} hard limit) — split before adding anything ` +
        `further (CLAUDE.md §0, "FILE SIZE LIMITS").`,
    )
    hardFail = true
  } else if (claudeSize >= CLAUDE_MD_WARN) {
    console.warn(
      `file-size-lint: WARN  CLAUDE.md  ${fmt(claudeSize)} chars ` +
        `(>= ${fmt(CLAUDE_MD_WARN)} warn threshold) — plan a split ` +
        `(CLAUDE.md §0, "FILE SIZE LIMITS").`,
    )
  } else {
    console.log(`file-size-lint: OK    CLAUDE.md  ${fmt(claudeSize)} chars`)
  }

  const docsFiles = walkMarkdown(DOCS_DIR).sort()
  for (const file of docsFiles) {
    const size = byteLength(file)
    const label = relPath(file)
    if (size >= DOCS_WARN) {
      console.warn(
        `file-size-lint: WARN  ${label}  ${fmt(size)} chars ` +
          `(>= ${fmt(DOCS_WARN)} warn threshold) — consider splitting.`,
      )
    } else {
      console.log(`file-size-lint: OK    ${label}  ${fmt(size)} chars`)
    }
  }

  if (hardFail) {
    console.error('\nfile-size-lint: 1 hard failure. See above.')
    process.exit(1)
  }

  console.log(`\nfile-size-lint: clean (${docsFiles.length + 1} files checked, no hard failures).`)
}

main()
