import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Migration 021 — idx_jobs_claim is a PARTIAL index, and a partial index is only
// usable when the query predicate IMPLIES the index predicate. That makes the
// index and lib/queue/jobs.ts a single coupled contract split across two files:
// if either side drifts, Postgres silently stops using the index and the
// 60-second claim poll degrades to a Seq Scan — no error, no failing behaviour,
// nothing to notice until the table is large and the damage is done.
//
// So this file is a STATIC SOURCE ASSERTION over both artifacts (same technique
// as reactivate-copy.test.ts's no-write-surface guard): it parses the real SQL
// and the real TypeScript and fails on disagreement. It deliberately does NOT
// import MAX_ATTEMPTS — the constant is module-private, and exporting it purely
// for a test would widen the module's surface to serve the guard rather than the
// other way round.
//
// This is the same two-independent-gates-that-must-agree discipline as 019's
// duplicated CHECK/CASE column whitelist; the migration comment names this test,
// and this test names the migration.

const REPO_ROOT = join(__dirname, '..', '..')
const MIGRATION_PATH = join(REPO_ROOT, 'supabase/migrations/021_index_hygiene.sql')
const JOBS_LIB_PATH = join(REPO_ROOT, 'lib/queue/jobs.ts')

const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')
const jobsSource = readFileSync(JOBS_LIB_PATH, 'utf8')

// Strip `--` comment lines before parsing SQL. The migration's own prose quotes
// the predicate verbatim (that is the point of the load-bearing comment), so
// parsing the raw file would happily match the explanation instead of the
// statement it explains.
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

/** The CREATE INDEX idx_jobs_claim statement, comments removed. */
function claimIndexStatement(): string {
  const m = executableSql.match(/CREATE\s+INDEX\s+idx_jobs_claim[\s\S]*?;/i)
  if (!m) throw new Error('021: CREATE INDEX idx_jobs_claim statement not found')
  return m[0]
}

/** MAX_ATTEMPTS as literally written in lib/queue/jobs.ts. */
function maxAttemptsFromSource(): number {
  const m = jobsSource.match(/const\s+MAX_ATTEMPTS\s*=\s*(\d+)/)
  if (!m) throw new Error('jobs.ts: MAX_ATTEMPTS declaration not found')
  return Number(m[1])
}

/** Every `.in('status', [...])` filter in jobs.ts, as arrays of status values. */
function statusFiltersFromSource(): string[][] {
  const matches = [...jobsSource.matchAll(/\.in\(\s*'status'\s*,\s*\[([^\]]*)\]\s*\)/g)]
  if (matches.length === 0) throw new Error("jobs.ts: no .in('status', [...]) filter found")
  return matches.map((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
  )
}

describe('021 / claimJobs — partial index predicate contract', () => {
  it('the index attempt_count bound equals MAX_ATTEMPTS in jobs.ts', () => {
    const predicateBound = claimIndexStatement().match(/attempt_count\s*<\s*(\d+)/)
    expect(predicateBound, 'idx_jobs_claim must bound attempt_count in its predicate').not.toBeNull()

    // THE load-bearing assertion. claimJobs filters `attempt_count < MAX_ATTEMPTS`;
    // the index is only usable if that implies the index predicate, which holds
    // exactly when the two integers are equal. Raise MAX_ATTEMPTS without editing
    // 021 and the index goes silently unusable — this is what catches that.
    expect(Number(predicateBound![1])).toBe(maxAttemptsFromSource())
  })

  it('MAX_ATTEMPTS is pinned at 5 (change here => change 021 in the same commit)', () => {
    expect(maxAttemptsFromSource()).toBe(5)
  })

  it('the index status predicate covers exactly the statuses claimJobs queries', () => {
    const stmt = claimIndexStatement()

    // Every status jobs.ts filters on must be in the index predicate, or rows of
    // that status are absent from the index and the planner must reject it —
    // the original idx_jobs_poll defect ('failed' was missing).
    for (const filter of statusFiltersFromSource()) {
      for (const status of filter) {
        expect(stmt, `index predicate must cover status '${status}'`).toContain(`'${status}'`)
      }
    }

    expect(stmt).toContain("'pending'")
    expect(stmt).toContain("'failed'")

    // 'running' is written (jobs.ts:94) but never queried, so it must NOT be in
    // the predicate — carrying it would bloat the index with claimed rows for no
    // reader. If a stale-claim sweep is ever built it needs its OWN index; this
    // assertion is what forces that decision to be explicit.
    expect(stmt).not.toContain("'running'")
  })

  it('the index leads with next_retry_at so one scan serves filter + ORDER BY + LIMIT', () => {
    // claimJobs orders by next_retry_at ASC and takes LIMIT 3. A next_retry_at
    // leading column lets the planner walk in order and stop after 3 rows with no
    // Sort node. Leading with `status` (2-3 distinct values) cannot.
    expect(claimIndexStatement()).toMatch(/ON\s+public\.jobs\s*\(\s*next_retry_at\s*\)/i)
  })

  it('021 removes the superseded idx_jobs_poll rather than leaving both', () => {
    expect(executableSql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+idx_jobs_poll\s*;/i)
    expect(executableSql).not.toMatch(/CREATE\s+INDEX\s+idx_jobs_poll/i)
  })
})

describe('021 — redundant index drops', () => {
  it('drops the duplicate processed_messages SID index, not the UNIQUE constraint', () => {
    expect(executableSql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+idx_processed_messages_sid\s*;/i)

    // isNewMessage depends on the UNIQUE CONSTRAINT's 23505, never on a plain
    // index. Nothing in 021 may touch the constraint or its backing index.
    expect(executableSql).not.toMatch(/processed_messages_message_sid_key/i)
    expect(executableSql).not.toMatch(/ALTER\s+TABLE[\s\S]*processed_messages[\s\S]*DROP\s+CONSTRAINT/i)
  })

  it('drops the plain whatsapp_sessions phone index but NEVER the UNIQUE one', () => {
    expect(executableSql).toMatch(
      /DROP\s+INDEX\s+IF\s+EXISTS\s+idx_whatsapp_sessions_phone_number\s*;/i,
    )

    // uq_whatsapp_sessions_phone_number (012:34) backs ON CONFLICT (phone_number)
    // in every session RPC. Dropping it would break the morning flow outright.
    // The two names differ by one prefix, so this guards the likeliest fatal typo.
    expect(executableSql).not.toMatch(/DROP\s+INDEX[^;]*uq_whatsapp_sessions_phone_number/i)
  })

  it('mutates no data — index DDL only', () => {
    for (const verb of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
    ]) {
      expect(executableSql, `021 must contain no ${verb.source}`).not.toMatch(verb)
    }
  })
})
