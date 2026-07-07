import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'node:path'

// Load ONLY .env.test — physically separate from .env.local. The production
// service key that lives in .env.local is therefore never read into scope
// during a test run: a stronger guarantee than "we didn't reference it".
// .env.test is gitignored (.gitignore: `.env*`); real secrets never commit.
loadDotenv({ path: resolve(__dirname, '.env.test') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Hard allowlist guard runs ONCE, before any test file, and aborts the
    // whole run unless the resolved target is the test-db branch.
    globalSetup: ['./test/setup/guard.ts'],
    // Test B holds a row lock across an 800ms injected sleep; give headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Keep files sequential so the shared test tenant / phone-prefix cleanup
    // never overlaps across files.
    fileParallelism: false,
  },
})
