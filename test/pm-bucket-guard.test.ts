import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// T-NOBUCKET-1 (PR-D1 review round 1, S2). T-NOWRITE-1 guards the capture_files TABLE; nothing guarded the BUCKET. There is no
// storage.objects policy (049:1016-1017) and service_role can remove or overwrite objects, so a later `.remove([path])` or
// `.upload(..., { upsert: true })` in a file that holds a service client would pass every table guard. The bytes behind a
// `stored` row are the evidence; the 051 row immutability protects only the metadata.
//
// PURE FILE SCAN: no database, no network. It states three things:
//   (a) the code files that name the bucket are exactly the writer and the signer;
//   (b) in the signer every `.storage` chain calls only createSignedUrl, and no other storage verb appears anywhere in the file;
//   (c) in the writer every `.storage` chain uses only the verbs it uses today (quoted below) and `.upload(` is never an upsert.
// Like T-NOWRITE-1 this is a convention guard, not the control: the control is the absence of any other caller with a service client.

const ROOT = resolve(__dirname, '..')

/** Code files under the repo root, excluding node_modules, .next, .git and the top-level test/ and docs/ trees. */
function codeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue
    const p = join(dir, name)
    if (dir === ROOT && (name === 'test' || name === 'docs')) continue
    if (statSync(p).isDirectory()) codeFiles(p, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/')
/** The bucket by name, or either capture bucket constant (CAPTURE_BUCKET in the writer, PM_CAPTURE_BUCKET in the signer). */
const BUCKET_REF = /capture-documents|\bCAPTURE_BUCKET\b|\bPM_CAPTURE_BUCKET\b/

const WRITER = 'lib/media/capture-ingest.ts'
const SIGNER = 'lib/capture/pm-file-access.ts'

/**
 * Index where the statement that contains `start` ends (same rules as T-NOWRITE-1's scanner in capture-handler.test.ts): a `;`
 * or `,` at bracket depth 0, a closer that would take the depth below 0, or a newline at depth 0 whose next significant text
 * is not a `.` continuation (line comments between chain parts are skipped). Strings are skipped.
 */
function statementEnd(src: string, start: number): number {
  let depth = 0
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth < 0) return i
    } else if (depth === 0 && (c === ';' || c === ',')) return i
    else if (depth === 0 && c === '\n') {
      const next = /^(?:\s+|\/\/[^\n]*(?:\n|$))*(\S)/.exec(src.slice(i + 1))
      if (!next || next[1] !== '.') return i
    }
    i++
  }
  return src.length
}

/** The method names called at the TOP level of a chain (arguments are skipped): `.storage.from(B).upload(p, x)` -> from, upload. */
function topLevelVerbs(chain: string): string[] {
  const verbs: string[] = []
  let depth = 0
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < chain.length && chain[i] !== c) {
        if (chain[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === '.' && depth === 0) {
      const m = /^\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(chain.slice(i))
      if (m) verbs.push(m[1])
    }
  }
  return verbs
}

/** Every `.storage` chain in the source, up to the end of its statement. */
function storageChains(src: string): string[] {
  return [...src.matchAll(/\.storage\b/g)].map((m) => src.slice(m.index, statementEnd(src, m.index + m[0].length)))
}

// Verbs a storage chain may call. `from` selects the bucket and is allowed everywhere.
const SIGNER_VERBS = ['createSignedUrl'] as const
// The writer's storage verbs TODAY, quoted from lib/media/capture-ingest.ts (line numbers as of this commit):
//   :596  ctx.supabase.storage.from(CAPTURE_BUCKET).upload(storagePath, bytes, { upsert: false, contentType: type })
//   :614  ctx.supabase.storage.from(CAPTURE_BUCKET).download(storagePath)
const WRITER_VERBS = ['upload', 'download'] as const
// A planted verb in the signer turns the file-wide ban red even outside a `.storage` chain.
const BANNED_IN_SIGNER = /\.(remove|upload|move|copy|update|list|createSignedUploadUrl|getPublicUrl)\s*\(/

describe('T-NOBUCKET-1: the capture-documents bucket has exactly one writer and one signer', () => {
  it('(a) the code files that name the bucket or a capture bucket constant are exactly the writer and the signer', () => {
    const hits = codeFiles(ROOT)
      .filter((f) => BUCKET_REF.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(hits).toEqual([SIGNER, WRITER].sort())
  })

  it('(b) signer: every .storage chain calls only createSignedUrl (plus from), at least once', () => {
    const src = readFileSync(join(ROOT, SIGNER), 'utf8')
    const chains = storageChains(src)
    expect(chains.length, 'the signer must have a .storage chain').toBeGreaterThan(0)
    for (const chain of chains) {
      const verbs = topLevelVerbs(chain)
      const allowed = new Set<string>(['from', ...SIGNER_VERBS])
      expect(verbs.filter((v) => !allowed.has(v)), `signer .storage chain calls an unlisted verb: ${chain.replace(/\s+/g, ' ').slice(0, 140)}`).toEqual([])
      expect(verbs, `signer .storage chain must call createSignedUrl: ${chain.replace(/\s+/g, ' ').slice(0, 140)}`).toContain('createSignedUrl')
    }
  })

  it('(b2) signer: no other storage verb appears anywhere in the file (not even outside a .storage chain, comments included)', () => {
    expect(readFileSync(join(ROOT, SIGNER), 'utf8')).not.toMatch(BANNED_IN_SIGNER)
  })

  it('(c) writer: its .storage chains use only the verbs it uses today (upload, download), and an upload is never an upsert', () => {
    const src = readFileSync(join(ROOT, WRITER), 'utf8')
    const chains = storageChains(src)
    const used = new Set<string>()
    const allowed = new Set<string>(['from', ...WRITER_VERBS])
    for (const chain of chains) {
      const verbs = topLevelVerbs(chain)
      expect(verbs.filter((v) => !allowed.has(v)), `writer .storage chain calls an unlisted verb: ${chain.replace(/\s+/g, ' ').slice(0, 140)}`).toEqual([])
      for (const v of verbs) if (v !== 'from') used.add(v)
      if (verbs.includes('upload')) {
        expect(chain, 'an upload must say upsert: false').toMatch(/upsert:\s*false/)
        expect(chain, 'an upload must never upsert').not.toMatch(/upsert:\s*true/)
      }
    }
    expect([...used].sort(), 'WRITER_VERBS is stale: list exactly the verbs the writer uses').toEqual([...WRITER_VERBS].sort())
    expect(src).not.toMatch(/\.(remove|move|copy)\s*\(/)
  })

  it('(d) the chain scanner itself: ends a statement where it should, reads top-level verbs, and sees a verb hidden after a comment line', () => {
    const one = "a(c.storage.from(B).upload(p, x, { upsert: false }), other)\nnext()"
    const s = one.indexOf('.storage')
    const chain = one.slice(s, statementEnd(one, s + '.storage'.length))
    expect(chain).toBe('.storage.from(B).upload(p, x, { upsert: false })')
    expect(topLevelVerbs(chain)).toEqual(['from', 'upload'])
    const hidden = 'const r = await c.storage\n  .from(B)\n  // note\n  .remove([p])\nnext()'
    const h = hidden.indexOf('.storage')
    expect(topLevelVerbs(hidden.slice(h, statementEnd(hidden, h + '.storage'.length)))).toContain('remove')
    expect(topLevelVerbs('.storage.from(B).createSignedUrl(p, 60, d ? { download: d.trim() } : undefined)')).toEqual(['from', 'createSignedUrl'])
  })
})
