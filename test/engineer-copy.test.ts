// Every exported string in lib/engineers/copy.ts must be non-empty after
// trimming. The test iterates the module's exports (recursing into the
// grouped objects) rather than naming them, so a future export cannot be
// added without being covered. A non-string, non-object export also fails:
// the file is strings only.
import { describe, expect, it } from 'vitest'
import * as copy from '@/lib/engineers/copy'

function collect(value: unknown, path: string, out: Array<[string, unknown]>) {
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collect(child, `${path}.${key}`, out)
    }
  } else {
    out.push([path, value])
  }
}

const entries: Array<[string, unknown]> = []
for (const [name, value] of Object.entries(copy)) collect(value, name, entries)

describe('engineer copy', () => {
  it('exports at least one string', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s is a non-empty string', (path, value) => {
    expect(typeof value, `${path} must be a string`).toBe('string')
    expect((value as string).trim(), `${path} must not be empty`).not.toBe('')
  })
})
