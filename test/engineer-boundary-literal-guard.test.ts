// Add-engineer slice 1, PR A. T21: the boundary-literal SOURCE GUARD
// (docs/plans/add-engineer-plan.md section 7.3, T21). Pure: reads source text,
// touches no database.
//
// The plan asks for "`+91` followed by a digit appears only in
// test/helpers/boundary-phone.ts" across test/. That cannot hold repo-wide as
// written: existing files (test/unit/outbound-send.test.ts,
// test/unit/outbound-checkpoint-trigger.test.ts, test/unit/reactivate-copy.test.ts,
// ...) already carry such literals, and this slice may not edit an existing test
// file. So the guard is scoped to the files THIS SLICE creates -- named limit,
// recorded in the build log and the PR body.
//
// What each assertion protects (plan 7.3): every Indian-shaped number is a
// routable live handset, so the slice mints exactly one, in one place; the DB
// test that stores it can never reach a Twilio send (it imports nothing that
// sends, and its project is non-active so no cron roster loads its engineer).
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TEST_DIR = join(process.cwd(), 'test')
const BOUNDARY_HELPER = 'helpers/boundary-phone.ts'

// Every test file this slice created.
const SLICE_FILES = [
  ...readdirSync(TEST_DIR)
    .filter((f) => /^engineer-.*\.test\.tsx?$/.test(f) && f !== 'engineer-copy.test.ts')
    .sort(),
  BOUNDARY_HELPER,
  'helpers/engineer-gate-matrix.ts',
]

const source = (file: string) => readFileSync(join(TEST_DIR, file), 'utf8')

// A "+91" immediately followed by a digit: the shape of an Indian number literal.
const INDIAN_LITERAL = /\+91\d/g

describe('T21: the boundary literal is minted in one place', () => {
  it('the guard sees this slice\'s files', () => {
    expect(SLICE_FILES).toEqual(
      expect.arrayContaining([
        'engineer-add-render.test.tsx',
        'engineer-add.test.ts',
        'engineer-boundary-literal-guard.test.ts',
        'engineer-confirm-set.test.ts',
        'engineer-gate-agreement.test.ts',
        'engineer-gate.test.ts',
        'engineer-parse-roster.test.ts',
        'engineer-tenant-isolation.test.ts',
        BOUNDARY_HELPER,
      ]),
    )
  })

  it('an Indian-number literal appears in test/helpers/boundary-phone.ts and in no other file this slice created', () => {
    const hits = SLICE_FILES.filter((f) => (source(f).match(INDIAN_LITERAL) ?? []).length > 0)
    expect(hits).toEqual([BOUNDARY_HELPER])
  })

  it('and there it appears exactly once: the single named constant', () => {
    expect(source(BOUNDARY_HELPER).match(INDIAN_LITERAL)).toHaveLength(1)
    expect(source(BOUNDARY_HELPER)).toMatch(/export const TEST_BOUNDARY_PHONE_LITERAL = '\+91\d{10}'/)
  })
})

describe('T21: the DB test that stores the boundary literal can never send', () => {
  const dbTest = source('engineer-add.test.ts')

  it('imports test/helpers/db.ts', () => {
    expect(dbTest).toMatch(/from '\.\/helpers\/db'/)
  })

  it('imports nothing under lib/whatsapp/outbound/ or app/api/cron/', () => {
    for (const file of SLICE_FILES.filter((f) => f !== 'engineer-boundary-literal-guard.test.ts')) {
      const imports = source(file)
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from\s+['"]/.test(l) || /^\s*import\s+['"]/.test(l))
        .join('\n')
      expect(imports, file).not.toMatch(/lib\/whatsapp\/outbound/)
      expect(imports, file).not.toMatch(/app\/api\/cron/)
    }
  })

  it("neutralises its fixture project with an explicit non-active status, and never sets it 'active'", () => {
    expect(dbTest).toMatch(/\.from\('projects'\)\.update\(\{ status: 'on_hold' \}\)/)
    expect(dbTest).not.toMatch(/\.update\(\{ status: 'active' \}\)/)
    expect(dbTest).not.toMatch(/\.update\(\{ status: null \}\)/)
  })
})
