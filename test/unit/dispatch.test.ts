import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Static source guard for dispatch.ts's onBeforeRetry hook (webhook-wiring,
// migration 022 review package §10). onBeforeRetry is TEST-ONLY -- it lets a
// test fire a callback between dispatchInboundTurn's two RPC calls to
// deterministically construct the double-wrong_flow race (see
// test/dispatch.test.ts) without a real timing race. A hook that could
// silently reach production and run injected logic mid-turn is exactly the
// kind of thing that should fail a build, not rely on a doc comment -- this
// guard is the real protection; dispatch.ts's own docstring only documents
// that it exists.
//
// Scans CODE, not prose: a comment documenting the hook's existence (e.g.
// "dispatchInboundTurn also accepts a test-only onBeforeRetry, never passed
// here") must not trip the guard. Strip block + line comments before
// asserting (mirrors reactivate-copy.test.ts / check-profile-lookups.mjs).
describe('webhook route — no onBeforeRetry reference (static source guard)', () => {
  const raw = readFileSync(join(process.cwd(), 'app/api/whatsapp/webhook/route.ts'), 'utf8')
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:]|^)\/\/.*$/gm, '$1')

  it('route.ts contains no reference to onBeforeRetry', () => {
    expect(src).not.toContain('onBeforeRetry')
  })

  // The sibling guard that used to live here -- "route.ts contains no
  // reference to onBeforeStart" -- is REMOVED, 2026-08-28, not merely
  // passing vacuously. onBeforeStart itself no longer exists anywhere in
  // the codebase: retirement (lib/whatsapp/inbound-start.ts's own header,
  // design-decisions-beta-feedback.md §38) deleted routeInboundMessage's
  // startFlow:true RPC call entirely, and onBeforeStart existed only to
  // let a test race that specific call. A guard asserting the absence of
  // a hook that has been deleted everywhere protects nothing; keeping it
  // would be a stale artifact, not a real check.
})
