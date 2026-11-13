import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  extractDefinedFunctionNames,
  ruleFunctionRedefinitionRequiresCapture,
} from '../../scripts/lint-migrations.mjs'

// 052 S-B / S-D (docs/reviews/052-design/kind-removal-plan.md section E, "Lint Rule 10
// becomes schema-aware"). Pure string-in / violations-out; the wiring block at the bottom
// spawns the real linter (file reads only, no database).

type Entry = { qualified: string; raw: string; sql: string }
const entry = (qualified: string, raw: string): Entry => ({
  qualified,
  raw,
  // The real linter passes comment-stripped SQL as `sql`; these fixtures carry no
  // comments in the SQL part, so raw doubles as sql unless a test says otherwise.
  sql: raw,
})
const fn = (name: string) => `CREATE OR REPLACE FUNCTION ${name}(p uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`
const run = (...entries: Entry[]) => ruleFunctionRedefinitionRequiresCapture(entries)

describe('extractDefinedFunctionNames (schema-aware keys)', () => {
  it('keys unqualified and public. forms identically, as public.<name>', () => {
    expect([...extractDefinedFunctionNames(fn('foo'))]).toEqual(['public.foo'])
    expect([...extractDefinedFunctionNames(fn('public.foo'))]).toEqual(['public.foo'])
  })
  it('keys another schema as schema.name', () => {
    expect([...extractDefinedFunctionNames(fn('private.capture_apply_classification'))]).toEqual([
      'private.capture_apply_classification',
    ])
  })
  it('is case-insensitive', () => {
    expect([...extractDefinedFunctionNames(fn('Private.Foo'))]).toEqual(['private.foo'])
  })
})

describe('Rule 10 — function-redefinition-requires-capture, schema-aware', () => {
  it('a first definition in private is never a violation', () => {
    expect(run(entry('a.sql', fn('private.h')))).toEqual([])
  })

  it('RED: a later redefinition of a private function with no baseline line is flagged, schema-qualified key (S-B)', () => {
    const v = run(entry('a.sql', fn('private.h')), entry('b.sql', fn('private.h')))
    expect(v).toEqual([
      {
        file: 'b.sql',
        object: 'uncaptured-redefinition-private.h',
        rule: 'function-redefinition-requires-capture',
      },
    ])
  })

  it('RED: a public redefinition keeps the BARE-name key, so existing exemptions keep matching (S-D)', () => {
    const v = run(entry('a.sql', fn('public.f')), entry('b.sql', fn('f')))
    expect(v).toHaveLength(1)
    expect(v[0].object).toBe('uncaptured-redefinition-f')
    expect(v[0].object).not.toContain('public.')
  })

  it('multiple redefined names join with a comma, public bare and other schemas qualified', () => {
    const v = run(
      entry('a.sql', fn('public.f') + fn('private.h')),
      entry('b.sql', fn('public.f') + fn('private.h')),
    )
    expect(v[0].object).toBe('uncaptured-redefinition-f,private.h')
  })

  it('GREEN: a redefinition carrying its body_md5 line and the capture command is clean', () => {
    const raw =
      '-- body_md5 (pre-052): cecc170b26208d4b820402879e020271 h\n-- captured with pg_get_functiondef\n' +
      fn('private.h')
    expect(run(entry('a.sql', fn('private.h')), entry('b.sql', raw))).toEqual([])
  })

  it('the same bare name in two schemas are two functions: private.h does not make public.h a redefinition', () => {
    expect(run(entry('a.sql', fn('private.h')), entry('b.sql', fn('public.h')))).toEqual([])
  })

  it('a baseline line without the capture command still flags', () => {
    const raw = '-- body_md5 (pre-052): cecc170b26208d4b820402879e020271 h\n' + fn('private.h')
    expect(run(entry('a.sql', fn('private.h')), entry('b.sql', raw))).toHaveLength(1)
  })
})

describe('lint-migrations entry guard (SQL review round 1, S-1)', () => {
  it('runs main() when invoked through a symlinked directory (a gate must never be green without running)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lintlink-'))
    try {
      const link = join(dir, 'scripts-link')
      symlinkSync(join(__dirname, '..', '..', 'scripts'), link)
      let out = ''
      let status = 0
      try {
        out = execFileSync('node', [join(link, 'lint-migrations.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; status?: number }
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`
        status = err.status ?? 1
      }
      expect(status === 0 || status === 1).toBe(true)
      expect(out).toMatch(/^migration-lint:/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('lint-migrations wiring', () => {
  // Decoupled from the other rules on purpose: the whole-tree result can be red for an unrelated rule
  // (e.g. shared-fixture-fk-coverage on a held file) without Rule 10 being wrong.
  it('running the script directly runs main() (importing it above did not), and Rule 10 flags nothing on the real tree', () => {
    let out = ''
    try {
      out = execFileSync('node', [join(__dirname, '..', '..', 'scripts', 'lint-migrations.mjs')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    expect(out).toMatch(/^migration-lint:/m)
    expect(out).not.toMatch(/function-redefinition-requires-capture/)
  })
})
