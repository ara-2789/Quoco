// The shared T6 matrix (docs/plans/add-engineer-plan.md section 7.2): ONE data
// table, TWO runners --
//   - test/engineer-gate.test.ts runs it through the pure TypeScript gate;
//   - test/engineer-gate-agreement.test.ts runs it through the real SQL gate
//     (add_engineers_to_project, dry-run) on test-db and asserts the two agree.
//
// No conclusion may rest on rows 3-8 alone: they use users.role = 'pm' or a
// non-admin role, shapes that do not exist in prod (a real PM is users.role
// 'admin' + project_members.role 'pm'). Rows 1, 2, 9 and 11 exist for real.
export type MatrixVerdict = 'allow' | 'not_permitted' | 'not_found'

export interface GateMatrixRow {
  n: number
  role: 'admin' | 'pm' | 'qs' | 'engineer' | null
  // Whose tenant the caller belongs to.
  callerTenant: 'own' | 'null'
  // Which project the call targets, relative to the caller.
  project: 'own_tenant' | 'other_tenant' | 'nonexistent'
  // The caller's project_members row on the target project.
  membership: 'none' | 'pm' | 'engineer'
  expected: MatrixVerdict
  prodShape: 'yes' | 'fixture-only' | 'pre-onboarding stub' | 'constructed'
}

export const ENGINEER_GATE_MATRIX: readonly GateMatrixRow[] = [
  { n: 1, role: 'admin', callerTenant: 'own', project: 'own_tenant', membership: 'none', expected: 'allow', prodShape: 'yes' },
  { n: 2, role: 'admin', callerTenant: 'own', project: 'own_tenant', membership: 'pm', expected: 'allow', prodShape: 'yes' },
  { n: 3, role: 'pm', callerTenant: 'own', project: 'own_tenant', membership: 'pm', expected: 'allow', prodShape: 'fixture-only' },
  { n: 4, role: 'pm', callerTenant: 'own', project: 'own_tenant', membership: 'none', expected: 'not_permitted', prodShape: 'fixture-only' },
  { n: 5, role: 'pm', callerTenant: 'own', project: 'own_tenant', membership: 'engineer', expected: 'not_permitted', prodShape: 'fixture-only' },
  { n: 6, role: 'qs', callerTenant: 'own', project: 'own_tenant', membership: 'pm', expected: 'not_permitted', prodShape: 'fixture-only' },
  { n: 7, role: 'engineer', callerTenant: 'own', project: 'own_tenant', membership: 'pm', expected: 'not_permitted', prodShape: 'fixture-only' },
  { n: 8, role: null, callerTenant: 'own', project: 'own_tenant', membership: 'pm', expected: 'not_permitted', prodShape: 'pre-onboarding stub' },
  { n: 9, role: 'admin', callerTenant: 'own', project: 'other_tenant', membership: 'none', expected: 'not_found', prodShape: 'yes' },
  { n: 10, role: 'admin', callerTenant: 'null', project: 'own_tenant', membership: 'none', expected: 'not_found', prodShape: 'constructed' },
  { n: 11, role: 'admin', callerTenant: 'own', project: 'nonexistent', membership: 'none', expected: 'not_found', prodShape: 'yes' },
]

// A fresh, run-unique, NON-Indian fixture number that passes the RPC's generic
// shape check (^\+[1-9][0-9]{1,14}$, plan 3.6): '+199955' plus eight random
// digits = 14 digits. Needed because testPhone() (test/helpers/db.ts) yields 16
// digits, which the function rightly refuses (22023 "invalid number shape").
// Never Indian-shaped, so never a routable handset; the +1 block matches the
// repo's fixture convention (plan 7.3).
export function freshFixtureNumber(): string {
  let digits = ''
  for (let i = 0; i < 8; i++) digits += Math.floor(Math.random() * 10)
  return `+199955${digits}`
}

// The pure gate's input for a matrix row. `visibility` says how the project
// reaches the gate: 'visible' passes the project row even when it belongs to
// another tenant (so the gate's own tenant comparison is what refuses it);
// 'rls' passes null for a project the caller cannot see, as the real page
// would under RLS.
export function gateInputForRow(
  row: GateMatrixRow,
  visibility: 'visible' | 'rls',
): {
  profile: { id: string; tenant_id: string | null; role: string | null }
  project: { id: string; tenant_id: string } | null
  isProjectPm: boolean
} {
  const profile = {
    id: 'caller-id',
    tenant_id: row.callerTenant === 'null' ? null : 'tenant-own',
    role: row.role,
  }
  let project: { id: string; tenant_id: string } | null
  if (row.project === 'nonexistent') {
    project = null
  } else if (row.project === 'other_tenant') {
    project = visibility === 'visible' ? { id: 'project-x', tenant_id: 'tenant-other' } : null
  } else if (row.callerTenant === 'null' && visibility === 'rls') {
    // get_user_tenant_id() is NULL, so projects_select shows the caller nothing.
    project = null
  } else {
    project = { id: 'project-x', tenant_id: 'tenant-own' }
  }
  return { profile, project, isProjectPm: row.membership === 'pm' }
}
