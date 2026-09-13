// Batch 1 of the per-run fixture-identifier migration
// (docs/reviews/test-db-per-run-fixture-identifiers.md). Runs once, via
// vitest globalSetup, before any test file -- generates ONE random value
// for the whole `vitest run` invocation and threads it to every test file
// via Vitest's own provide()/inject() mechanism.
//
// WHY provide()/inject(), NOT a plain module-level constant (verified
// empirically, not assumed -- see the design doc's §1): Vitest resets the
// module registry per test file by default (`isolate: true`), even with
// fileParallelism:false and even within a single sequential run. A plain
// `export const RUN_ID = crypto.randomUUID()` in an imported helper module
// would re-evaluate to a DIFFERENT value every time a new test file imports
// it -- exactly the opposite of what "per-run" means. provide()/inject()
// crosses that per-file reset deliberately; confirmed live to return the
// identical value across files under BOTH fileParallelism:false and
// fileParallelism:true, and confirmed to work even when read at a plain
// top-level `export const` in an imported module (not just inside a
// running test/hook) -- so call sites do not need to become functions.
//
// WHY NOT process.env: also verified to work in this exact config (forks
// pool, env inherited at fork time) -- but that behaviour is an
// implementation detail of the 'forks' pool, not a documented contract.
// provide()/inject() is Vitest's own supported mechanism for exactly this
// need and does not depend on which pool is configured.
//
// This module does ONE thing: mint the run id and provide it. It does NOT
// derive any fixture UUIDs itself -- see test/helpers/run-scoped-fixtures.ts
// for the pure derivation function every fixture family will eventually use.
// Kept separate from test/setup/guard.ts deliberately: guard.ts's only job
// is the hard abort-on-wrong-database check; mixing concerns there would
// make a future audit of either one harder than it needs to be.

import { randomUUID } from 'node:crypto'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    quocoTestRunId: string
  }
}

export default function setupRunId(project: TestProject): void {
  project.provide('quocoTestRunId', randomUUID())
}
