// Drives three of the DPR eval harness's golden cases through the REAL
// pipeline (callDprModel + renderDpr) and dumps output for human review.
// Addition 2 of the 2026-08-11 DPR generator slice: "one live project-day
// proves the machinery runs; it does not prove the output is any good."
// Deliberately does NOT assert pass/fail — the cases' own assertCase*
// functions are run and their result printed as INFORMATIONAL context
// only, per Aravind's explicit instruction not to auto-assert.
//
// These fixtures hand-author their own rawInputText (mirroring the deleted
// spike script's style) rather than going through lib/dpr/generate.ts's
// buildPrompt — they were written before that function existed, and
// rewriting them to go through it would mean modifying files that are this
// generator's own acceptance criteria. callDprModel (generate.ts) is used
// directly instead, then validateJudgment is run against the SAME function
// the real pipeline uses, against each case's own exported Facts — so this
// exercises the real containment AND no-digit checks, just with a
// hand-authored prompt in place of an assembled one.
// No narrative context exists for these fixtures (they're Facts-only,
// no daily_logs row) — the no-digit fields will be sparser than a live
// run's; noted in the output, not hidden.
//
// Run: npx tsx scripts/dump-golden-cases.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import Anthropic from '@anthropic-ai/sdk'
import { callDprModel } from '../lib/dpr/generate'
import { validateJudgment } from '../lib/dpr/validate'
import { renderDpr } from '../lib/dpr/render'
import * as caseComplete from '../lib/dpr/eval/cases/case-complete-two-engineer-day'
import * as caseNotCaptured from '../lib/dpr/eval/cases/case-manpower-equipment-not-captured'
import * as caseMorningMissing from '../lib/dpr/eval/cases/case-morning-missing-evening-present'

const anthropic = new Anthropic()
const META = { project_name: 'Site A - Tower 2', log_date: '2026-08-09' }

const CASES = [
  {
    name: 'case-complete-two-engineer-day',
    facts: {
      execution: caseComplete.executionFacts,
      schedule: caseComplete.scheduleFacts,
      manpower: caseComplete.manpowerFacts,
      equipment: caseComplete.equipmentFacts,
      tomorrows_plan: caseComplete.tomorrowsPlanFacts,
    },
    rawInputText: caseComplete.rawInputText,
    assertCase: caseComplete.assertCase,
  },
  {
    name: 'case-manpower-equipment-not-captured',
    facts: {
      execution: caseNotCaptured.executionFacts,
      schedule: caseNotCaptured.scheduleFacts,
      manpower: caseNotCaptured.manpowerFacts,
      equipment: caseNotCaptured.equipmentFacts,
      tomorrows_plan: caseNotCaptured.tomorrowsPlanFacts,
    },
    rawInputText: caseNotCaptured.rawInputText,
    assertCase: caseNotCaptured.assertCase01,
  },
  {
    name: 'case-morning-missing-evening-present',
    facts: {
      execution: caseMorningMissing.executionFacts,
      schedule: caseMorningMissing.scheduleFacts,
      manpower: caseMorningMissing.manpowerFacts,
      equipment: caseMorningMissing.equipmentFacts,
      tomorrows_plan: caseMorningMissing.tomorrowsPlanFacts,
    },
    rawInputText: caseMorningMissing.rawInputText,
    assertCase: caseMorningMissing.assertCase07,
  },
]

async function main() {
  console.log(
    'NOTE: these fixtures carry no narrative raw-text context (no daily_logs row backs them) — ' +
      'no-digit fields (schedule_miss_reason_note, manpower_idle_reason_note, equipment idle_reason_note, ' +
      'tomorrows_plan_carry_forward_note) will be sparser here than on a live run.\n',
  )

  for (const c of CASES) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`CASE: ${c.name}`)
    console.log('='.repeat(80))

    let result
    try {
      result = await callDprModel(anthropic, c.rawInputText, c.facts)
    } catch (err) {
      console.error(`  FAILED TO GENERATE: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    const validationResult = validateJudgment(result.judgment, c.facts.execution, META)
    console.log(`\n--- VALIDATION (containment + no-digit) ---`)
    if (validationResult.ok) {
      console.log('PASS — no violations')
    } else {
      for (const v of validationResult.violations) {
        console.log(`VIOLATION [${v.kind}] ${v.field}: ${v.detail}`)
      }
      console.log('(This would throw DprValidationError in the real pipeline — reported here, not enforced, since dump scripts should never silently stop mid-batch.)')
    }

    console.log(`\n--- USAGE / COST ---`)
    console.log(`Input: ${result.usage.input_tokens}  Output: ${result.usage.output_tokens}  Latency: ${result.latency_ms}ms  Cost: $${result.cost_usd.toFixed(6)}`)

    console.log(`\n--- RAW JUDGMENT (model output) ---`)
    console.log(JSON.stringify(result.judgment, null, 2))

    const { content } = renderDpr(c.facts, result.judgment, [])
    console.log(`\n--- RENDERED CONTENT ---`)
    console.log(content)

    console.log(`\n--- THIS CASE'S OWN assertCase (informational only, not a gate) ---`)
    const failures = c.assertCase(result.judgment)
    if (failures.length === 0) {
      console.log('No failures reported by this case\'s own assertions.')
    } else {
      for (const f of failures) console.log(`  - ${f}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
