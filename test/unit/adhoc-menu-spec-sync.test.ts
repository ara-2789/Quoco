import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  buildIdleReply,
  type IdleHeaderState,
} from '@/lib/whatsapp/inbound-start'

// SYNC CHECK (2026-09-06, Aravind's own question on PR #218): the spec's
// "Idle-inbound reply, decided" section is documentation-that-could-lie
// unless something checks it against the code -- the exact failure shape
// bot-flows.md's own dead 30-minute TTL already demonstrated once this
// project. This test extracts the quoted reply text directly from
// docs/plans/adhoc-menu-spec.md and asserts it matches inbound-start.ts's
// own composed output. inbound-start.ts remains the single source of
// truth (per that file's own header comment); this test only proves the
// spec's reference copy hasn't drifted from it.
//
// PARSEABLE FORMAT CONSTRAINT, NAMED: each combination below must be
// written as exactly as many `> `-prefixed lines as the actual reply has
// real line breaks -- NEVER wrap one reply line across two `>` lines for
// markdown readability. This bit the typed-"2" set once (its correction
// line was originally soft-wrapped across two `>` lines); fixed the same
// day this test was added. If this test fails after a pure markdown
// reformat with no copy change, check for exactly that first.

const SPEC_PATH = path.join(process.cwd(), 'docs/plans/adhoc-menu-spec.md')
const spec = fs.readFileSync(SPEC_PATH, 'utf-8')

// The order the spec numbers its five combinations, 1-5, under every
// section -- matches computeIdleHeaderState's own state names exactly.
const HEADER_ORDER: IdleHeaderState[] = [
  'awaiting_morning',
  'morning_closed',
  'site_holiday',
  'complete',
  'none',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract the N reply combinations following a section marker. Bold
 * "**...**" markers are anchored to their own line (a prose reference to
 * the same text mid-sentence, e.g. this file's own header comment above,
 * must never match instead); a plain-text marker is matched by its first
 * occurrence, which the caller is responsible for keeping unique in the
 * document.
 */
function extractCombinations(marker: string, expectedCount: number): string[] {
  let startIdx: number
  if (marker.startsWith('**')) {
    const re = new RegExp('^' + escapeRegExp(marker) + '$', 'm')
    const match = re.exec(spec)
    if (!match) throw new Error(`Line-start marker not found in spec: ${marker}`)
    startIdx = match.index
  } else {
    startIdx = spec.indexOf(marker)
    if (startIdx === -1) throw new Error(`Marker not found in spec: ${marker}`)
  }

  const afterMarker = spec.slice(startIdx + marker.length)
  const nextSectionIdx = afterMarker.search(/\n\*\*[A-Z]|\n## /)
  const body = nextSectionIdx === -1 ? afterMarker : afterMarker.slice(0, nextSectionIdx)

  const combos: string[][] = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    const numbered = line.match(/^\d+\.\s*(.*)$/)
    if (numbered) {
      combos.push([])
      const quotedInline = numbered[1].match(/^>\s?(.*)$/)
      if (quotedInline) combos[combos.length - 1].push(quotedInline[1])
      continue
    }
    const quoted = line.match(/^>\s?(.*)$/)
    if (quoted && combos.length > 0) {
      combos[combos.length - 1].push(quoted[1])
    }
  }
  if (combos.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} combinations under "${marker}", found ${combos.length}: ${JSON.stringify(combos)}`,
    )
  }
  return combos.map((lines) => lines.join('\n'))
}

describe('adhoc-menu-spec.md idle-reply copy matches inbound-start.ts exactly', () => {
  it('free text / unparseable', () => {
    const combos = extractCombinations('**Free text / unparseable:**', 5)
    combos.forEach((combo, i) => {
      expect(combo).toBe(buildIdleReply('unrecognized', HEADER_ORDER[i]))
    })
  })

  it('typed "2"', () => {
    const combos = extractCombinations('**Typed "2":**', 5)
    combos.forEach((combo, i) => {
      expect(combo).toBe(buildIdleReply('item2', HEADER_ORDER[i]))
    })
  })

  it('typed "3", "4", "5", "6", or "7"', () => {
    const combos = extractCombinations('**Typed "3", "4", "5", "6", or "7":**', 5)
    combos.forEach((combo, i) => {
      expect(combo).toBe(buildIdleReply('item_reserved', HEADER_ORDER[i]))
    })
  })

  // "item 1's interim reply" test REMOVED, 2026-09-07 -- the section it
  // checked (docs/plans/adhoc-menu-spec.md's "Item 1's interim reply") is
  // itself struck through now that step 4 shipped; item 1 starts the real
  // flow unconditionally and has no header-varying reply left to sync
  // against. See that section's own SUPERSEDED note for the full record.
})
