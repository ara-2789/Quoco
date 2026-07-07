import { describe, it, expect, afterEach } from 'vitest'
import { isTestStartTrigger, TEST_START_TOKEN } from '@/lib/whatsapp/flows/test-trigger'

// Env-gate unit tests for the TEST-ONLY morning-flow start trigger. The start
// path must be structurally unreachable unless ENABLE_TEST_FLOW_TRIGGER is
// exactly 'true' AND the body is exactly the sentinel token.

const WRONG_TOKEN = 'please start morning'

describe('isTestStartTrigger (env-gated start trigger)', () => {
  // Restore the env var after each case so ordering can't leak state.
  afterEach(() => {
    delete process.env.ENABLE_TEST_FLOW_TRIGGER
  })

  it('unset env + correct token -> false (env gate blocks it)', () => {
    delete process.env.ENABLE_TEST_FLOW_TRIGGER
    expect(isTestStartTrigger(TEST_START_TOKEN)).toBe(false)
  })

  it("env 'true' + correct token -> true", () => {
    process.env.ENABLE_TEST_FLOW_TRIGGER = 'true'
    expect(isTestStartTrigger(TEST_START_TOKEN)).toBe(true)
  })

  it("env 'true' + wrong token -> false", () => {
    process.env.ENABLE_TEST_FLOW_TRIGGER = 'true'
    expect(isTestStartTrigger(WRONG_TOKEN)).toBe(false)
  })

  it("unset env + wrong token -> false", () => {
    delete process.env.ENABLE_TEST_FLOW_TRIGGER
    expect(isTestStartTrigger(WRONG_TOKEN)).toBe(false)
  })

  it("env set to a non-'true' value + correct token -> false (strict equality)", () => {
    process.env.ENABLE_TEST_FLOW_TRIGGER = '1'
    expect(isTestStartTrigger(TEST_START_TOKEN)).toBe(false)
  })

  it('correct token surrounded by whitespace still matches when env is true', () => {
    process.env.ENABLE_TEST_FLOW_TRIGGER = 'true'
    expect(isTestStartTrigger(`  ${TEST_START_TOKEN}  `)).toBe(true)
  })
})
