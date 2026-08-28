import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// STATIC SOURCE GUARD (same technique as jobs-claim-index.test.ts's index/
// query-predicate check, dispatch.test.ts's onBeforeRetry/onBeforeStart
// absence check) for the invariant trigger.ts's 429 re-claim CAS depends on:
//
//   No .update() in this file may leave a row at status='sending' (i.e. an
//   update that does not itself set status to a terminal value) while
//   writing anything into `error` other than `null` or the literal
//   RATE_LIMITED_MARKER.
//
// WHY THIS MATTERS, RESTATED FROM THE FINDING THIS TEST CLOSES: the 429
// re-claim CAS matches on `status='sending' AND error=RATE_LIMITED_MARKER`.
// That is safe ONLY because, today, the one writer of REAL Twilio error
// text into `error` always sets `status='failed'` in the same atomic
// UPDATE -- a 'failed' row can never satisfy the CAS's status half
// regardless of what its error text says. That is an invariant of this
// file's CONTROL FLOW, not something the schema enforces (outbound_sends.
// error is a plain nullable TEXT column with no CHECK tying its content to
// status). It would break silently the day a future change adds, say,
// `.update({ error: err.message })` inside the 5xx or network-exception
// branch (a natural-looking addition for debugging that says nothing about
// re-claim semantics) -- a real Twilio error string would then sit on a
// still-'sending' row, and a coincidental future collision with the
// marker's own text would make that row wrongly re-claimable.
//
// This test scans the REAL SOURCE of trigger.ts, not a re-implementation
// of its logic -- a change that violates the invariant fails THIS test
// directly, without needing a database or a specific Twilio response
// sequence to trigger it. Brace-depth counting (not a single regex) is
// used to extract each `.update({...})` call's body correctly even where
// it contains its own braces (the 4xx branch's error value is a template
// literal, `` `HTTP ${sendResult.status}` `` -- a naive non-greedy regex
// would stop at that inner `}` instead of the call's real closing brace).

const SOURCE_PATH = join(process.cwd(), 'lib/whatsapp/outbound/trigger.ts')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^:]|^)\/\/.*$/gm, '$1')
}

/** Every `.update({ ... })` call body in `source`, braces included, extracted by depth-counting so nested braces (e.g. inside a template literal) don't truncate the match early. */
function extractUpdateBlocks(source: string): string[] {
  const marker = '.update({'
  const blocks: string[] = []
  let searchFrom = 0
  for (;;) {
    const markerStart = source.indexOf(marker, searchFrom)
    if (markerStart === -1) break
    const braceStart = markerStart + marker.length - 1 // index of the opening '{'
    let depth = 0
    let end = -1
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) {
      throw new Error(`extractUpdateBlocks: unbalanced braces scanning from index ${markerStart}`)
    }
    blocks.push(source.slice(braceStart, end + 1))
    searchFrom = end + 1
  }
  return blocks
}

describe('trigger.ts CAS invariant (static source guard)', () => {
  const source = stripComments(readFileSync(SOURCE_PATH, 'utf8'))
  const updateBlocks = extractUpdateBlocks(source)

  it('finds the expected shape of trigger.ts -- fails loudly if the file is refactored out from under this guard, rather than silently matching nothing', () => {
    // Four .update({...}) calls exist today: the re-claim CAS, the 429
    // marker write, the non-retryable-4xx failure write, and the terminal
    // 'sent' write. A count outside this range means the file's shape
    // changed and this guard's own coverage needs re-deriving, not that
    // the invariant necessarily broke -- surfaced as a hard failure either
    // way, per this project's own "fail loud rather than vacuously pass"
    // standard for exactly this kind of guard.
    expect(updateBlocks.length).toBe(4)
  })

  it('no update that leaves status at "sending" writes anything into error except null or the literal RATE_LIMITED_MARKER', () => {
    let sendingRowUpdatesChecked = 0

    for (const block of updateBlocks) {
      const setsTerminalStatus = /status:\s*'(sent|failed)'/.test(block)
      if (setsTerminalStatus) continue // status='sent'/'failed' rows are outside the invariant -- they can never satisfy the CAS's status='sending' half regardless of their error text

      const errorAssignment = block.match(/\berror:\s*([^,}]+)/)
      if (!errorAssignment) continue // doesn't touch error at all -- introduces nothing new, invariant not implicated

      sendingRowUpdatesChecked++
      const value = errorAssignment[1].trim()
      expect(['null', 'RATE_LIMITED_MARKER']).toContain(value)
    }

    // Sanity: both the re-claim CAS (error: null) and the 429 branch
    // (error: RATE_LIMITED_MARKER) must actually have been exercised by
    // the loop above -- a change that removed one of them (weakening the
    // mechanism itself) would otherwise let this test pass vacuously by
    // having nothing left to check.
    expect(sendingRowUpdatesChecked).toBe(2)
  })

  it('the two terminal updates (status=sent, status=failed) exist and are correctly identified as terminal', () => {
    const terminalBlocks = updateBlocks.filter((b) => /status:\s*'(sent|failed)'/.test(b))
    expect(terminalBlocks).toHaveLength(2)
  })
})
