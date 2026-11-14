// Migration 052 (MI-KIND-REMOVAL) -- the S-2 source tripwire, "N-C" in the plan, written EXACTLY as ruled in SQL review round 1,
// answer 1 (docs/reviews/052-sql-review-round-1.md) and plan section F.
//
// WHAT IT GUARDS. Plan A4b declined an in-database check that capture_documents.received_at equals the capture time, because the
// only insert path is public.apply_material_inward_turn, which writes received_at from the very row it looked up two statements
// earlier. This test is what keeps that sentence true: it reads the SQL source, so a future second insert path (another function, a
// MERGE, a dynamic EXECUTE, a top-level backfill) or an RPC that stops writing received_at fails here, before it can be applied.
//
// STATIC: no database. It reads supabase/migrations/*.sql, the claimedBy paths of scripts/migration-number-reservations.json, and
// scripts/test-db-only-*.sql.
//
// THE RULES (SQL review round 1, answer 1)
//  * Forward set = supabase/migrations/*.sql plus every claimedBy path in the reservations file. DOWN files fall out because they are
//    not forward files, NOT because of their names.
//  * Latest definition per schema.name, in apply order (migration number). A later DROP FUNCTION removes the function from the set.
//  * Matcher, case-insensitive, on comment-stripped text:
//      (INSERT|MERGE)\s+INTO\s+("?public"?\s*\.\s*)?"?capture_documents"?\b
//    An EXECUTE whose text names capture_documents together with INSERT or MERGE is also a hit.
//  * Across the latest definitions plus the top-level statements of every forward file: exactly ONE hit, inside
//    public.apply_material_inward_turn; its column list contains received_at; the same function holds the processed_messages lookup
//    keyed on p_message_sid.
//  * scripts/test-db-only-*.sql are scanned too, with ONE named allow-list entry: quoco_test_capture_insert (it does
//    EXECUTE format('INSERT INTO public.%1$I ...') over an allow-list that names capture_documents; test-db only; its absence from prod
//    is probed before every prod apply).
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

interface Source {
  path: string
  text: string
}

interface FnDef {
  key: string
  body: string
  source: string
}

interface Hit {
  where: string
  via: 'literal' | 'execute' | 'dynamic-function'
  cols: string | null
  source: string
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}

// ---- the matcher (verbatim from the ruling) ----
const INSERT_RE = /\b(?:INSERT|MERGE)\s+INTO\s+(?:"?public"?\s*\.\s*)?"?capture_documents"?\b(?:\s*\(([^)]*)\))?/gi

/** Hits in a piece of comment-stripped SQL: literal INSERT/MERGE INTO capture_documents, and any EXECUTE that names it with INSERT/MERGE. */
function hitsIn(code: string, where: string, source: string): Hit[] {
  const out: Hit[] = []
  for (const m of code.matchAll(INSERT_RE)) out.push({ where, via: 'literal', cols: m[1] ?? null, source })
  for (const m of code.matchAll(/\bEXECUTE\b[^;]*;/gi)) {
    if (/capture_documents/i.test(m[0]) && /\b(?:INSERT|MERGE)\b/i.test(m[0])) out.push({ where, via: 'execute', cols: null, source })
  }
  return out
}

/** A function that runs a dynamic INSERT/MERGE and names capture_documents anywhere in its body (the test-db helper's shape). */
function isDynamicInserter(body: string): boolean {
  const execs = [...body.matchAll(/\bEXECUTE\b[^;]*;/gi)].map((m) => m[0])
  return execs.some((e) => /\b(?:INSERT|MERGE)\b/i.test(e)) && /capture_documents/i.test(body)
}

// ---- parsing: function definitions (dollar-quoted bodies), DROP FUNCTION, top-level text ----
function parseSource(code: string, source: string): { events: Array<{ pos: number; def?: FnDef; drop?: string }>; rest: string } {
  const events: Array<{ pos: number; def?: FnDef; drop?: string }> = []
  let rest = code
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const start = m.index
    const tag = /\$([A-Za-z_]\w*)?\$/g
    tag.lastIndex = re.lastIndex
    const open = tag.exec(code)
    let end: number
    let body: string
    if (open) {
      const close = code.indexOf(open[0], open.index + open[0].length)
      if (close < 0) throw new Error(`unterminated dollar-quoted body in ${source}`)
      end = close + open[0].length
      body = code.slice(open.index + open[0].length, close)
    } else {
      end = code.indexOf(';', re.lastIndex)
      end = end < 0 ? code.length : end + 1
      body = code.slice(re.lastIndex, end)
    }
    const key = `${(m[1] ?? 'public').toLowerCase()}.${m[2].toLowerCase()}`
    events.push({ pos: start, def: { key, body, source } })
    rest = rest.slice(0, start) + ' '.repeat(end - start) + rest.slice(end)
    re.lastIndex = end
  }
  for (const d of rest.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?/gi)) {
    events.push({ pos: d.index ?? 0, drop: `${(d[1] ?? 'public').toLowerCase()}.${d[2].toLowerCase()}` })
  }
  events.sort((a, b) => a.pos - b.pos)
  return { events, rest }
}

interface Scan {
  hits: Hit[]
  latest: Map<string, FnDef>
}

/** The forward set, in apply order: latest definition per schema.name, a later DROP removes it; top-level statements of every file. */
function scanForward(sources: Source[]): Scan {
  const latest = new Map<string, FnDef>()
  const hits: Hit[] = []
  for (const s of sources) {
    const { events, rest } = parseSource(stripComments(s.text), s.path)
    for (const ev of events) {
      if (ev.def) latest.set(ev.def.key, ev.def)
      if (ev.drop) latest.delete(ev.drop)
    }
    hits.push(...hitsIn(rest, `top-level ${s.path}`, s.path))
  }
  for (const def of latest.values()) {
    hits.push(...hitsIn(def.body, def.key, def.source))
    if (isDynamicInserter(def.body) && !hits.some((h) => h.where === def.key && h.via !== 'dynamic-function')) {
      hits.push({ where: def.key, via: 'dynamic-function', cols: null, source: def.source })
    }
  }
  return { hits, latest }
}

/** The assertions of the ruling. Returns the list of problems (empty = the invariant holds). */
function problems(scan: Scan): string[] {
  const out: string[] = []
  if (scan.hits.length !== 1) {
    out.push(`expected exactly one capture_documents insert site, found ${scan.hits.length}: ${scan.hits.map((h) => `${h.where} [${h.via}] in ${h.source}`).join('; ')}`)
  }
  const only = scan.hits[0]
  if (only) {
    if (only.where !== 'public.apply_material_inward_turn') out.push(`the only insert site is in ${only.where}, not in public.apply_material_inward_turn`)
    else if (!/\breceived_at\b/i.test(only.cols ?? '')) out.push(`the INSERT column list ${JSON.stringify(only.cols)} does not contain received_at`)
  }
  const fn = scan.latest.get('public.apply_material_inward_turn')
  if (!fn) out.push('public.apply_material_inward_turn has no live definition in the forward set')
  else if (!/FROM\s+(?:public\.)?processed_messages\b[\s\S]{0,200}?=\s*p_message_sid\b/i.test(fn.body)) {
    out.push('public.apply_material_inward_turn has no processed_messages lookup keyed on p_message_sid')
  }
  return out
}

// ---- the real sources ----
function forwardSources(): Source[] {
  const byNumber = new Map<number, string>()
  const migDir = resolve(ROOT, 'supabase/migrations')
  for (const f of readdirSync(migDir)) {
    const m = /^(\d+)_.*\.sql$/.exec(f)
    if (m) byNumber.set(Number(m[1]), `supabase/migrations/${f}`)
  }
  const reservations = JSON.parse(readFileSync(resolve(ROOT, 'scripts/migration-number-reservations.json'), 'utf8')) as Array<{ number: string; claimedBy: string }>
  for (const e of reservations) {
    const n = Number(e.number)
    if (!byNumber.has(n) && existsSync(resolve(ROOT, e.claimedBy))) byNumber.set(n, e.claimedBy)
  }
  return [...byNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => ({ path: p, text: readFileSync(resolve(ROOT, p), 'utf8') }))
}

function testDbOnlySources(): Source[] {
  const dir = resolve(ROOT, 'scripts')
  return readdirSync(dir)
    .filter((f) => /^test-db-only-.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ path: `scripts/${f}`, text: readFileSync(resolve(dir, f), 'utf8') }))
}

const ALLOW_LISTED_TEST_DB_ONLY = new Set(['public.quoco_test_capture_insert'])

/** Hits in the test-db-only scripts (every function counts: none of them is a forward migration), minus the one allow-listed entry. */
function testDbOnlyHits(sources: Source[]): { all: Hit[]; unallowed: Hit[] } {
  const all: Hit[] = []
  for (const s of sources) {
    const { events, rest } = parseSource(stripComments(s.text), s.path)
    all.push(...hitsIn(rest, `top-level ${s.path}`, s.path))
    for (const ev of events) {
      if (!ev.def) continue
      all.push(...hitsIn(ev.def.body, ev.def.key, s.path))
      if (isDynamicInserter(ev.def.body) && !all.some((h) => h.where === ev.def!.key && h.source === s.path && h.via !== 'dynamic-function')) {
        all.push({ where: ev.def.key, via: 'dynamic-function', cols: null, source: s.path })
      }
    }
  }
  return { all, unallowed: all.filter((h) => !ALLOW_LISTED_TEST_DB_ONLY.has(h.where)) }
}

const PLANT_PATH = 'supabase/migrations/999_planted_control.sql'
const plant = (text: string): Source => ({ path: PLANT_PATH, text })

describe('S-2 / N-C source tripwire: capture_documents has exactly one insert path (static)', () => {
  const real = forwardSources()

  it('the forward set contains the live migrations and the held 052 file, in apply order, and no DOWN file', () => {
    const paths = real.map((s) => s.path)
    expect(paths).toContain('supabase/migrations/050_material_inward_functions.sql')
    expect(paths).toContain('supabase/migrations/051_capture_files_immutability.sql')
    expect(paths.some((p) => /052_mi_kind_deferred\.sql$/.test(p))).toBe(true)
    expect(paths.filter((p) => /down/i.test(p))).toEqual([])
    const numbers = paths.map((p) => Number(/\/(\d+)_/.exec(p)![1]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('THE TRIPWIRE: exactly one insert site, inside public.apply_material_inward_turn, whose column list has received_at, with the processed_messages lookup keyed on p_message_sid', () => {
    const scan = scanForward(real)
    expect(problems(scan)).toEqual([])
    expect(scan.hits).toHaveLength(1)
    expect(scan.hits[0]!.where).toBe('public.apply_material_inward_turn')
    expect(scan.hits[0]!.source).toMatch(/052_mi_kind_deferred\.sql$/) // the LATEST definition (052's), not 050's
  })

  it('scripts/test-db-only-*.sql: the only insert site is the one allow-listed entry, quoco_test_capture_insert (and that entry is not dead)', () => {
    const { all, unallowed } = testDbOnlyHits(testDbOnlySources())
    expect(unallowed).toEqual([])
    expect(all.some((h) => h.where === 'public.quoco_test_capture_insert')).toBe(true)
  })

  // ---- controls: the same scanner against planted sources. Each is RED (a violation is reported) and names its reason ----
  it('control 1 (RED): a second inserting function in a planted held file', () => {
    const p = problems(
      scanForward([...real, plant('CREATE FUNCTION public.second_inserter() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.capture_documents (tenant_id, received_at) VALUES (NULL, now()); END; $$;')]),
    )
    expect(p.join('|')).toMatch(/exactly one capture_documents insert site, found 2/)
  })

  it('control 2 (RED): a later redefinition whose forward INSERT has no received_at', () => {
    const body = `CREATE OR REPLACE FUNCTION public.apply_material_inward_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_message_sid text, p_media jsonb DEFAULT NULL::jsonb, p_start_flow boolean DEFAULT false, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
      RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v_r timestamptz; BEGIN
        SELECT pm.created_at INTO v_r FROM public.processed_messages pm WHERE pm.message_sid = p_message_sid;
        INSERT INTO public.capture_documents (tenant_id, project_id, sent_by, source_message_sid) VALUES (p_tenant_id, p_project_id, p_user_id, p_message_sid);
        RETURN NULL; END; $$;`
    expect(problems(scanForward([...real, plant(body)])).join('|')).toMatch(/does not contain received_at/)
  })

  it('control 3 (RED): a planted MERGE', () => {
    const p = problems(scanForward([...real, plant('CREATE FUNCTION public.merger() RETURNS void LANGUAGE plpgsql AS $$ BEGIN MERGE INTO public.capture_documents d USING (SELECT 1) s ON false WHEN NOT MATCHED THEN INSERT (tenant_id) VALUES (NULL); END; $$;')]))
    expect(p.join('|')).toMatch(/found 2/)
  })

  it('control 4 (RED): a lowercase, unqualified INSERT (and a quoted, aliased one)', () => {
    expect(problems(scanForward([...real, plant('create function public.lc() returns void language sql as $$ insert into capture_documents (tenant_id) values (null) $$;')])).join('|')).toMatch(/found 2/)
    expect(problems(scanForward([...real, plant('CREATE FUNCTION public.q() RETURNS void LANGUAGE sql AS $$ INSERT INTO "public"."capture_documents" AS d (tenant_id) VALUES (NULL) $$;')])).join('|')).toMatch(/found 2/)
  })

  it('control 4b (RED): a top-level INSERT outside any function (a backfill) is counted too', () => {
    expect(problems(scanForward([...real, plant("INSERT INTO public.capture_documents (tenant_id, received_at) SELECT NULL, now();")])).join('|')).toMatch(/found 2.*top-level/)
  })

  it('control 5 (RED): a dynamic EXECUTE naming the table', () => {
    const p = problems(scanForward([...real, plant("CREATE FUNCTION public.dyn() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE format('INSERT INTO public.%I (tenant_id) VALUES (NULL)', 'capture_documents'); END; $$;")]))
    expect(p.join('|')).toMatch(/exactly one capture_documents insert site, found [2-9]/)
  })

  it('control 6 (RED, zero sites): a later DROP of the inserting function removes it from the set', () => {
    const drop = 'DROP FUNCTION IF EXISTS public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamp with time zone, integer);'
    const p = problems(scanForward([...real, plant(drop)]))
    expect(p.join('|')).toMatch(/found 0/)
    expect(p.join('|')).toMatch(/no live definition/)
    // control for the control: dropping an UNRELATED function changes nothing
    expect(problems(scanForward([...real, plant('DROP FUNCTION IF EXISTS public.some_unrelated_function(text);')]))).toEqual([])
  })

  it('control 6b: a comment that mentions an INSERT is not a hit', () => {
    expect(problems(scanForward([...real, plant('-- INSERT INTO public.capture_documents (a) VALUES (1); described here only\n/* MERGE INTO capture_documents */')]))).toEqual([])
  })

  it('control 7 (GREEN): with the DOWN files present on disk the real tree still passes, because they are not forward files', () => {
    const downFiles = ['docs/reviews/052-down-testdb.sql', 'docs/reviews/052-down-prod.sql']
    for (const f of downFiles) expect(existsSync(resolve(ROOT, f)), `${f} exists`).toBe(true)
    expect(problems(scanForward(real))).toEqual([])
    // the DOWN files really would change the answer if they were forward (they restore the pre-052 body: an INSERT without received_at),
    // so excluding them is a decision the scanner makes by set membership, not a vacuous pass
    const asIfForward = downFiles.map((f) => ({ path: f, text: readFileSync(resolve(ROOT, f), 'utf8') }))
    expect(problems(scanForward([...real, ...asIfForward])).length).toBeGreaterThan(0)
  })

  it('control (test-db-only): a second dynamic inserter in a test-db-only script is flagged; removing the allow-list entry would flag the real helper', () => {
    const planted = {
      path: 'scripts/test-db-only-planted.sql',
      text: "CREATE FUNCTION public.quoco_test_other(p_row jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE format('INSERT INTO public.capture_documents (%s) SELECT 1', 'x'); END; $$;",
    }
    const flagged = testDbOnlyHits([...testDbOnlySources(), planted]).unallowed
    expect(flagged.map((h) => h.where)).toContain('public.quoco_test_other')
    const noAllow = testDbOnlyHits(testDbOnlySources()).all.filter((h) => !new Set<string>().has(h.where))
    expect(noAllow.some((h) => h.where === 'public.quoco_test_capture_insert')).toBe(true)
  })
})
