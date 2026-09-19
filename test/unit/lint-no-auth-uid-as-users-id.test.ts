import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ruleNoAuthUidAsUsersId,
  RULE_NAME,
} from '../../scripts/lint-rules/no-auth-uid-as-users-id.mjs'

// S1 lint (docs/plans/add-engineer-plan.md §4.10, T39 (3)-(7); D16; rev12 N1/N2).
// Pure string-in / violations-out — no database, no network. The wiring block at
// the bottom spawns the real linter over the migration files (file reads only).
//
// T39 (1)-(2) — "red on the unexcepted tree, then green" — cannot be a permanent
// test (the exceptions file is meant to stay populated); they were run once as
// the build's positive control and are captured in the PR record.

const fires = (sql: string) => ruleNoAuthUidAsUsersId('t.sql', sql).length > 0

describe('no-auth-uid-as-users-id — users.id forms (need a users mention)', () => {
  it.each([
    ['forward: id = auth.uid()', 'SELECT 1 FROM users WHERE id = auth.uid();'],
    ['forward, qualified: u.id = auth.uid()', 'SELECT 1 FROM public.users u WHERE u.id = auth.uid();'],
    ['REVERSED: auth.uid() = id', 'SELECT 1 FROM users WHERE auth.uid() = id;'],
    ['REVERSED, qualified: auth.uid() = u.id', 'SELECT 1 FROM users u WHERE auth.uid() = u.id;'],
    ['forward, initplan idiom: id = (SELECT auth.uid())', 'SELECT 1 FROM users WHERE id = (SELECT auth.uid());'],
    ['forward, initplan idiom, spaced/lowercase', 'SELECT 1 FROM users u WHERE u.id = ( select auth.uid() );'],
    ['REVERSED, initplan idiom: (SELECT auth.uid()) = id', 'SELECT 1 FROM users WHERE (SELECT auth.uid()) = id;'],
  ])('flags %s', (_label, sql) => {
    expect(fires(sql)).toBe(true)
  })

  it.each([
    ['forward: auth_id = auth.uid()', 'SELECT 1 FROM users WHERE auth_id = auth.uid();'],
    ['forward, qualified: u.auth_id', 'SELECT 1 FROM users u WHERE u.auth_id = auth.uid();'],
    ['REVERSED: auth.uid() = auth_id', 'SELECT 1 FROM users WHERE auth.uid() = auth_id;'],
    ['REVERSED, qualified: auth.uid() = u.auth_id', 'SELECT 1 FROM users u WHERE auth.uid() = u.auth_id;'],
    ['initplan idiom, forward: auth_id = (SELECT auth.uid())', 'SELECT 1 FROM users WHERE auth_id = (SELECT auth.uid());'],
    ['initplan idiom, REVERSED: (SELECT auth.uid()) = auth_id', 'SELECT 1 FROM users WHERE (SELECT auth.uid()) = auth_id;'],
    ['REVERSED look-alike: auth.uid() = id_x', 'SELECT 1 FROM users WHERE auth.uid() = id_x;'],
    [
      'the 007 shape: engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())',
      'CREATE POLICY "p" ON daily_logs USING (engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid()));',
    ],
    ['id = auth.uid() on a statement that never mentions users', 'SELECT 1 FROM profiles WHERE id = auth.uid();'],
  ])('does not flag %s', (_label, sql) => {
    expect(fires(sql)).toBe(false)
  })
})

describe('no-auth-uid-as-users-id — <x>_id forms, D16 (no users mention needed)', () => {
  it.each([
    ['engineer_id = auth.uid()', 'CREATE POLICY "p" ON daily_logs USING (engineer_id = auth.uid());'],
    ['REVERSED: auth.uid() = engineer_id', 'CREATE POLICY "p" ON daily_logs USING (auth.uid() = engineer_id);'],
    ['REVERSED, qualified, initplan: (SELECT auth.uid()) = dl.engineer_id', 'CREATE POLICY "p" ON daily_logs USING ((SELECT auth.uid()) = dl.engineer_id);'],
    ['tenant_id = auth.uid()', 'SELECT 1 FROM projects WHERE tenant_id = auth.uid();'],
    ['a digit in the column name', 'SELECT 1 FROM t WHERE project2_id = auth.uid();'],
  ])('flags %s', (_label, sql) => {
    expect(fires(sql)).toBe(true)
  })

  it('treats auth_identity_id as a different column from auth_id, so it IS flagged', () => {
    // The auth_id exclusion is exact, not a prefix match; this pins that boundary.
    expect(fires('SELECT 1 FROM t WHERE auth_identity_id = auth.uid();')).toBe(true)
  })
})

describe('no-auth-uid-as-users-id — object keys, lines, comments', () => {
  it('keys on the enclosing policy name and reports every hit line', () => {
    const sql = [
      'CREATE POLICY "users_update" ON users',
      '  FOR UPDATE TO authenticated',
      '  USING (id = auth.uid())',
      '  WITH CHECK (id = auth.uid());',
    ].join('\n')
    const v = ruleNoAuthUidAsUsersId('t.sql', sql)
    expect(v).toEqual([{ file: 't.sql', object: 'users_update', rule: RULE_NAME, lines: [3, 4] }])
  })

  it('keys on the function name when the statement carries the CREATE header', () => {
    const sql = 'CREATE OR REPLACE FUNCTION public.f()\nRETURNS uuid AS $$\n  SELECT tenant_id FROM users WHERE id = auth.uid()\n$$;'
    expect(ruleNoAuthUidAsUsersId('t.sql', sql)[0]).toMatchObject({ object: 'f', lines: [3] })
  })

  it("keys L<line> for a hit after the first ';' inside a $$ body (known ';'-split limit)", () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION g() RETURNS void AS $$',
      'BEGIN',
      '  PERFORM 1;',
      '  UPDATE users SET x = 1 WHERE id = auth.uid();',
      'END;',
      '$$;',
    ].join('\n')
    expect(ruleNoAuthUidAsUsersId('t.sql', sql)).toEqual([
      { file: 't.sql', object: 'L4', rule: RULE_NAME, lines: [4] },
    ])
  })

  it('emits at most one violation per statement', () => {
    const sql = 'SELECT 1 FROM users WHERE id = auth.uid() OR auth.uid() = id OR engineer_id = auth.uid();'
    expect(ruleNoAuthUidAsUsersId('t.sql', sql)).toHaveLength(1)
  })

  it('ignores a bad pattern that appears only in a -- comment', () => {
    expect(fires('SELECT 1 FROM users WHERE auth_id = auth.uid(); -- was: id = auth.uid()\n')).toBe(false)
    expect(fires('-- WHERE id = auth.uid()\nSELECT 1 FROM users WHERE auth_id = auth.uid();')).toBe(false)
  })
})

// WIRING — the rule module is unit-tested above; this proves lint-migrations.mjs
// actually RUNS it over the real migration files. lint-migrations.mjs ends in an
// unconditional main() and cannot be imported (add-engineer plan UNKNOWN #28), so
// it is spawned. `--json` prints every RAW violation before the exceptions filter.
describe('no-auth-uid-as-users-id — wired into lint-migrations.mjs', () => {
  const repoRoot = join(__dirname, '..', '..')
  const script = join(repoRoot, 'scripts', 'lint-migrations.mjs')

  type Raw = { file: string; object: string; rule: string; lines?: number[] }
  const raw = (JSON.parse(
    execFileSync('node', [script, '--json'], { cwd: repoRoot, encoding: 'utf8' }),
  ) as Raw[]).filter((v) => v.rule === RULE_NAME)

  const migrationNumber = (file: string) => Number(/(\d+)_[^/]*$/.exec(file)?.[1])

  it('is registered: it flags the superseded 002 and 005 sites in the real tree', () => {
    const files = new Set(raw.map((v) => v.file))
    expect(files).toEqual(new Set(['002_rls_policies.sql', '005_auth_trigger.sql']))
    expect(raw.flatMap((v) => v.lines ?? [])).toHaveLength(16)
  })

  it('flags nothing in 007 or later (every known instance was superseded by 007)', () => {
    expect(raw.filter((v) => migrationNumber(v.file) >= 7)).toEqual([])
  })

  it('a plain run exits 0: every raw finding has an exceptions entry', () => {
    expect(() => execFileSync('node', [script], { cwd: repoRoot, stdio: 'pipe' })).not.toThrow()
  })
})
