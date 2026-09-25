// Add-engineer slice 1, PR A (A2 + A13), T6 TypeScript half. Pure.
// The SQL half and the agreement assertion are in
// test/engineer-gate-agreement.test.ts; both consume the SAME matrix
// (test/helpers/engineer-gate-matrix.ts).
import { describe, expect, it } from 'vitest'
import { decideEngineerAdminAccess } from '@/lib/engineers/gate'
import { ENGINEER_GATE_MATRIX, gateInputForRow } from './helpers/engineer-gate-matrix'

describe('T6 (TypeScript gate) -- plan section 7.2 matrix', () => {
  it('the matrix has the eleven rows of plan section 7.2, numbered 1..11', () => {
    expect(ENGINEER_GATE_MATRIX.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it.each(ENGINEER_GATE_MATRIX.map((r) => [r.n, r] as const))(
    'row %i: verdict matches when the project row is passed as-is',
    (_n, row) => {
      expect(decideEngineerAdminAccess(gateInputForRow(row, 'visible'))).toBe(row.expected)
    },
  )

  it.each(ENGINEER_GATE_MATRIX.map((r) => [r.n, r] as const))(
    'row %i: verdict matches when an RLS-invisible project reaches the gate as null',
    (_n, row) => {
      expect(decideEngineerAdminAccess(gateInputForRow(row, 'rls'))).toBe(row.expected)
    },
  )

  it('a qs user with a pm membership is refused (a membership-only rule would let them in)', () => {
    const qs = ENGINEER_GATE_MATRIX.find((r) => r.n === 6)!
    expect(decideEngineerAdminAccess(gateInputForRow(qs, 'visible'))).toBe('not_permitted')
  })

  it('no profile at all is not_permitted, never allow', () => {
    expect(
      decideEngineerAdminAccess({
        profile: null,
        project: { id: 'p', tenant_id: 't' },
        isProjectPm: true,
      }),
    ).toBe('not_permitted')
  })

  it('a NULL caller tenant never matches, even against a project whose tenant is a string', () => {
    expect(
      decideEngineerAdminAccess({
        profile: { id: 'u', tenant_id: null, role: 'admin' },
        project: { id: 'p', tenant_id: 't' },
        isProjectPm: false,
      }),
    ).toBe('not_found')
  })
})
