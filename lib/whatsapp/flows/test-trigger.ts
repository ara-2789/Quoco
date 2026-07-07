// TEST-ONLY morning-flow start trigger. Pass 1 has no cron, so the only way to
// START a flow is this sentinel — and ONLY when ENABLE_TEST_FLOW_TRIGGER is
// explicitly 'true'. Extracted from the webhook route so the env-gate logic is
// unit-testable in isolation; the route imports it unchanged.
//
// The env check is the short-circuiting FIRST operand of the &&, so the start
// path is structurally unreachable without ENABLE_TEST_FLOW_TRIGGER === 'true'.
// This env var MUST NOT be set in production Vercel (deployment checklist).

export const TEST_START_TOKEN = '__quoco_start_morning__'

export function isTestStartTrigger(body: string): boolean {
  return process.env.ENABLE_TEST_FLOW_TRIGGER === 'true' && body.trim() === TEST_START_TOKEN
}
