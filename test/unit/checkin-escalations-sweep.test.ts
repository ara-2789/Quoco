import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { testClient } from '../helpers/db'
import { fetchDueRoster } from '@/lib/checkin-escalations/roster'
import { sweepEngineerHalf, runCheckinEscalationSweep, runCheckinEscalationTickSweep } from '@/lib/checkin-escalations/sweep'

// Dedicated fixtures, distinct from test/helpers/db.ts's TEST_TENANT_ID /
// TEST_PROJECT_ID (the morning-flow suite's own fixtures) — this suite needs
// engineers in specific holiday/messaging_blocked states those fixtures don't
// model, and mixing the two risks exactly the cross-suite collision
// test/helpers/db.ts's own TEST-DB HYGIENE DEBT note already documents.

const TENANT_ID = '00000000-0000-4000-a000-0000000ce001'
const PROJECT_ID = '00000000-0000-4000-a000-0000000ce002'
// ENGINEER_NORMAL_ID_KEY MOVED from '+19995550301' to '+19995550600'
// (2026-08-27): a different suite (test/outbound-trigger.test.ts, before
// its own fixture bug was fixed) raced this file's own beforeAll, created
// a users row for '...0301' first under ITS tenant, and this file's
// "select by whatsapp_number, reuse if found" fixture logic silently
// adopted that row as normalId -- cross-tenant, unnoticed, because this
// file's own upsert never checks whether the row it found already belongs
// to a different tenant. Worse: that row is now permanently un-deletable
// under its wrong tenant (an outbound_sends row references it via a
// RESTRICT FK, and outbound_sends has no DELETE grant for any role, ever)
// -- so '...0301' cannot be reclaimed by this file again. '600' checked
// against every testPhone('NNN') and raw '+19995550NNN' literal already
// used anywhere under test/ before picking it.
//
// BLOCKED/HOLIDAY KEYS ALSO MOVED, same reason (2026-08-28): '...0302' and
// '...0303' still sat inside test/helpers/db.ts's own reserved-block
// registry -- the ENTIRE +199955503XX range is reserved wholesale to the
// outbound-send suite, not just the '...0301' point that actually
// collided. Moved to '601'/'602', adjacent to this file's own already-
// claimed '600'; both confirmed unclaimed by every other testPhone()/raw-
// literal use under test/ and by a live test-db lookup before picking them.
const ENGINEER_NORMAL_ID_KEY = '+19995550600' // whatsapp_number, unique key for lookup
const ENGINEER_BLOCKED_KEY = '+19995550601'
const ENGINEER_HOLIDAY_KEY = '+19995550602'
const LOG_DATE = '2026-09-01' // a date no other suite writes, per db.ts's own convention

let normalId: string
let blockedId: string
let holidayId: string

async function ensureEngineer(whatsapp: string, name: string, messagingBlocked: boolean): Promise<string> {
  const db = testClient()
  const { data: existing, error: selectError } = await db
    .from('users')
    .select('id, tenant_id')
    .eq('whatsapp_number', whatsapp)
    .maybeSingle<{ id: string; tenant_id: string }>()
  if (selectError) throw new Error(`ensureEngineer(${name}) select failed: ${selectError.message}`)
  if (existing) {
    // A row already sits at this phone number -- reuse it ONLY if it's
    // actually this suite's own (same tenant). Adopting a row under a
    // different tenant silently is exactly how '+19995550301' got
    // permanently poisoned (see the header comment above) -- loud
    // collision, never silent adoption.
    if (existing.tenant_id !== TENANT_ID) {
      throw new Error(
        `ensureEngineer(${name}): whatsapp_number ${whatsapp} already belongs to a DIFFERENT tenant -- ` +
          `existing row ${existing.id} is under tenant ${existing.tenant_id}, this suite needs tenant ${TENANT_ID}. ` +
          `Refusing to silently adopt a cross-tenant row -- pick an unclaimed phone slot instead ` +
          `(see test/helpers/db.ts's RESERVED PHONE/PREFIX BLOCKS registry).`,
      )
    }
    return existing.id
  }
  const { data, error } = await db
    .from('users')
    .insert({
      tenant_id: TENANT_ID,
      full_name: name,
      role: 'engineer',
      status: 'active',
      messaging_blocked: messagingBlocked,
      whatsapp_number: whatsapp,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`ensureEngineer(${name}) failed: ${error?.message ?? 'no row'}`)
  return data.id
}

beforeAll(async () => {
  const db = testClient()

  const { error: tenantError } = await db
    .from('tenants')
    .upsert({ id: TENANT_ID, name: 'ZZ Checkin-Escalations Suite', slug: 'zz-checkin-escalations' }, { onConflict: 'id' })
  if (tenantError) throw new Error(`beforeAll: tenants upsert failed: ${tenantError.message}`)

  const { error: projectError } = await db
    .from('projects')
    .upsert({ id: PROJECT_ID, tenant_id: TENANT_ID, name: 'ZZ Checkin-Escalations Project' }, { onConflict: 'id' })
  if (projectError) throw new Error(`beforeAll: projects upsert failed: ${projectError.message}`)

  normalId = await ensureEngineer(ENGINEER_NORMAL_ID_KEY, 'ZZ Normal Engineer', false)
  blockedId = await ensureEngineer(ENGINEER_BLOCKED_KEY, 'ZZ Blocked Engineer', true)
  holidayId = await ensureEngineer(ENGINEER_HOLIDAY_KEY, 'ZZ Holiday Engineer', false)

  for (const userId of [normalId, blockedId, holidayId]) {
    const { error: memberError } = await db
      .from('project_members')
      .upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: userId, role: 'engineer' }, { onConflict: 'project_id,user_id' })
    if (memberError) throw new Error(`beforeAll: project_members upsert failed for ${userId}: ${memberError.message}`)
  }

  // Holiday engineer reports a site-closed day — this is what filterDueRoster excludes on.
  const { error: dailyLogError } = await db.from('daily_logs').upsert(
    { tenant_id: TENANT_ID, project_id: PROJECT_ID, engineer_id: holidayId, log_date: LOG_DATE, is_holiday: true },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (dailyLogError) throw new Error(`beforeAll: daily_logs upsert failed: ${dailyLogError.message}`)
})

afterAll(async () => {
  const db = testClient()

  const { error: escalationsError } = await db.from('checkin_escalations').delete().eq('project_id', PROJECT_ID)
  if (escalationsError) throw new Error(`afterAll: checkin_escalations delete failed: ${escalationsError.message}`)

  const { error: dailyLogsError } = await db.from('daily_logs').delete().eq('project_id', PROJECT_ID)
  if (dailyLogsError) throw new Error(`afterAll: daily_logs delete failed: ${dailyLogsError.message}`)

  const { error: membersError } = await db.from('project_members').delete().eq('project_id', PROJECT_ID)
  if (membersError) throw new Error(`afterAll: project_members delete failed: ${membersError.message}`)

  const { error: projectDeleteError } = await db.from('projects').delete().eq('id', PROJECT_ID)
  if (projectDeleteError) throw new Error(`afterAll: projects delete failed: ${projectDeleteError.message}`)

  for (const userId of [normalId, blockedId, holidayId]) {
    if (userId) {
      const { error: userError } = await db.from('users').delete().eq('id', userId)
      if (userError) throw new Error(`afterAll: users delete failed for ${userId}: ${userError.message}`)
    }
  }

  const { error: tenantDeleteError } = await db.from('tenants').delete().eq('id', TENANT_ID)
  if (tenantDeleteError) throw new Error(`afterAll: tenants delete failed: ${tenantDeleteError.message}`)
})

describe('fetchDueRoster — against real data', () => {
  it('excludes the holiday engineer but includes the blocked engineer (Decision 1)', async () => {
    const db = testClient()
    const roster = await fetchDueRoster(db, PROJECT_ID, LOG_DATE)
    const ids = roster.map((r) => r.engineer_id)
    expect(ids).toContain(normalId)
    expect(ids).toContain(blockedId) // the corrected behaviour — stays in roster
    expect(ids).not.toContain(holidayId)
  })
})

describe('sweepEngineerHalf — guarded upsert against real data', () => {
  it('creates a row and advances it from awaited to escalated', async () => {
    const db = testClient()
    const now = '2026-09-01T05:00:00.000Z'
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now,
    })
    const { data } = await db
      .from('checkin_escalations')
      .select('status, escalated_at, closed_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', normalId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'morning')
      .single()
    expect(data?.status).toBe('escalated')
    // Postgres returns timestamptz as "+00:00", not "Z" — same instant,
    // different string. Compare by value, not raw string equality.
    expect(new Date(data?.escalated_at as string).getTime()).toBe(new Date(now).getTime())
    expect(data?.closed_at).toBeNull()
  })

  it('double-invocation with the same target leaves the timestamp UNCHANGED (Correction 2) — not merely the status', async () => {
    const db = testClient()
    const firstCallNow = '2026-09-01T05:00:00.000Z'
    const secondCallNow = '2026-09-01T06:00:00.000Z' // later clock, same computed target

    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: blockedId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now: firstCallNow,
    })
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: blockedId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now: secondCallNow,
    })

    const { data } = await db
      .from('checkin_escalations')
      .select('status, escalated_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', blockedId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'morning')
      .single()
    expect(data?.status).toBe('escalated')
    // The assertion that matters: NOT firstCallNow-or-secondCallNow loosely,
    // but exactly the FIRST call's timestamp — proving the second call's
    // guarded UPDATE matched zero rows rather than re-writing the same status
    // with a later timestamp. (Compared by value — see the note above on
    // Postgres's "+00:00" vs JS's "Z" suffix.)
    expect(new Date(data?.escalated_at as string).getTime()).toBe(new Date(firstCallNow).getTime())
  })

  it('a submitted row is never overwritten by a later not_submitted target — the one invariant named in the task', async () => {
    const db = testClient()
    const submittedAt = '2026-09-01T04:00:00.000Z'

    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'evening',
      targetStatus: 'submitted',
      now: submittedAt,
    })

    // Attempt the regression: a later, wrongly-computed target of not_submitted.
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'evening',
      targetStatus: 'not_submitted',
      now: '2026-09-01T20:00:00.000Z',
    })

    const { data } = await db
      .from('checkin_escalations')
      .select('status, closed_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', normalId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'evening')
      .single()
    expect(data?.status).toBe('submitted')
    expect(new Date(data?.closed_at as string).getTime()).toBe(new Date(submittedAt).getTime())
  })
})

// -----------------------------------------------------------------------------
// runCheckinEscalationSweep — the per-project-per-half orchestrator itself was
// never directly tested; only its two building blocks (fetchDueRoster,
// sweepEngineerHalf) were, above. A fresh log date, not '2026-09-01' used by
// the sweepEngineerHalf tests above -- reusing it would collide with rows
// those tests already advanced (the rank guard would then correctly refuse
// to move status per THIS test's own expectations, since it isn't aware of
// the earlier tests' own writes to the same key).
// -----------------------------------------------------------------------------

const SWEEP_LOG_DATE = '2026-09-15'

describe('runCheckinEscalationSweep — multi-engineer roster, both halves, against real data', () => {
  beforeAll(async () => {
    // fetchDueRoster's holiday exclusion is PER-DATE (daily_logs.is_holiday
    // for that specific project/date), not a permanent attribute of
    // holidayId -- the top-level beforeAll's own holiday row is scoped to
    // LOG_DATE ('2026-09-01'), not SWEEP_LOG_DATE. Without this, holidayId
    // is NOT excluded here and engineersConsidered comes back 3, not 2 --
    // found by actually running this test, not assumed.
    const db = testClient()
    const { error } = await db.from('daily_logs').upsert(
      { tenant_id: TENANT_ID, project_id: PROJECT_ID, engineer_id: holidayId, log_date: SWEEP_LOG_DATE, is_holiday: true },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (error) throw new Error(`beforeAll: SWEEP_LOG_DATE holiday daily_logs upsert failed: ${error.message}`)
  })

  it('morning half, now inside the escalate window: whole roster (holiday excluded) advances to escalated', async () => {
    const db = testClient()
    // 05:15 UTC = 10:45 IST -- past morningEscalate (10:30), before
    // morningCutoff (15:00).
    const now = new Date('2026-09-15T05:15:00.000Z')

    const result = await runCheckinEscalationSweep({
      client: db,
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      logDate: SWEEP_LOG_DATE,
      half: 'morning',
      now,
    })

    // Holiday engineer excluded by fetchDueRoster (Decision 1, already
    // covered above) -- normal + blocked only.
    expect(result.engineersConsidered).toBe(2)
    expect(result.writesAttempted).toBe(2)

    const { data } = await db
      .from('checkin_escalations')
      .select('engineer_id, status')
      .eq('project_id', PROJECT_ID)
      .eq('log_date', SWEEP_LOG_DATE)
      .eq('half', 'morning')
    const byEngineer = new Map((data ?? []).map((r) => [r.engineer_id as string, r.status as string]))
    expect(byEngineer.get(normalId)).toBe('escalated')
    expect(byEngineer.get(blockedId)).toBe('escalated')
    expect(byEngineer.has(holidayId)).toBe(false)
  })

  it('evening half, same roster, same now: NO escalation stage (Decision 3) -- target is awaited, not escalated', async () => {
    const db = testClient()
    // Same instant as the morning case above, deliberately -- proves the
    // two halves compute genuinely DIFFERENT targets from the identical
    // `now`, not merely different data.
    const now = new Date('2026-09-15T05:15:00.000Z')

    const result = await runCheckinEscalationSweep({
      client: db,
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      logDate: SWEEP_LOG_DATE,
      half: 'evening',
      now,
    })

    expect(result.engineersConsidered).toBe(2)
    expect(result.writesAttempted).toBe(2)

    const { data } = await db
      .from('checkin_escalations')
      .select('engineer_id, status')
      .eq('project_id', PROJECT_ID)
      .eq('log_date', SWEEP_LOG_DATE)
      .eq('half', 'evening')
    const byEngineer = new Map((data ?? []).map((r) => [r.engineer_id as string, r.status as string]))
    expect(byEngineer.get(normalId)).toBe('awaited')
    expect(byEngineer.get(blockedId)).toBe('awaited')
  })
})

// -----------------------------------------------------------------------------
// runCheckinEscalationTickSweep -- STUBBED, deliberately, not against real
// data. The wrapper's own active-projects query (`SELECT id, tenant_id FROM
// projects WHERE status='active'`) is unscoped and system-wide -- correct in
// production, but against the SHARED test DB it reaches into every other
// suite's own active-project fixtures, a footprint nothing else in this file
// (or this suite) has. Confirmed the hard way, not theorised (2026-09-04/05):
// real-DB versions of these two tests, run back to back with the rest of the
// suite four times in one session, correlated with the shared-fixture-
// teardown race documented in docs/reviews/test-fixture-lifecycle-flake.md
// escalating from 2 failing files (clean origin/main) to 11-17 (this branch)
// -- see that document's own dated entry for the full record. Rewritten
// below to stub the Supabase client entirely: the wrapper's loop, per-project
// isolation, both-halves behaviour, and failure collection are all verified
// in-memory. Zero real queries, zero shared-DB footprint, by construction --
// not "cleaned up harder," genuinely absent.
//
// THE REAL active-projects QUERY ITSELF IS NOT RE-VERIFIED HERE -- decided,
// not an oversight. It is a single, unconditional `.eq('status','active')`
// filter, identical in shape to app/api/cron/dpr-generate/route.ts's own
// query, already exercised by test/dpr-generate-trigger.test.ts's own "a
// non-active project (status != active) is never in the eligible set at
// all" test in this exact codebase. Re-proving the same Postgres primitive a
// second time, against the same shared-footprint risk this whole rewrite
// exists to remove, for zero new coverage, isn't worth it. If this query's
// own shape ever needs its own dedicated test, dpr-generate-trigger.test.ts's
// is the pattern to copy -- kept single-project-scoped there, not doubled up
// here.
//
// fetchDueRoster and sweepEngineerHalf's own real-DB tests above are
// untouched -- they were never the problem. Both are scoped to this file's
// own dedicated TENANT_ID/PROJECT_ID fixture and never reach outside it;
// the hazard is specific to the wrapper's unscoped, system-wide query, not
// to real-DB testing in general.
// -----------------------------------------------------------------------------

// 05:15 UTC = 10:45 IST -- past morningEscalate (10:30), before
// morningCutoff (15:00) -- morning -> escalated, evening -> awaited. Purely
// synthetic now; no real fixture date to collide with.
const WRAPPER_NOW = new Date('2026-09-16T05:15:00.000Z')

interface StubWrite {
  project_id: string
  engineer_id: string
  log_date: string
  half: string
  status: string
}

interface StubRosterEngineer {
  id: string
  full_name: string
  role: string
  status: string
  whatsapp_number: string
}

interface StubProjectFixture {
  roster: StubRosterEngineer[]
  dailyLogs: { engineer_id: string; is_holiday?: boolean; morning_submitted_at?: string | null; evening_submitted_at?: string | null }[]
}

/**
 * A purpose-built stub, not a general-purpose mock -- implements exactly the
 * query shapes runCheckinEscalationTickSweep's own call chain uses (projects
 * select; project_members select via fetchDueRoster; daily_logs select, both
 * for the holiday check and the submitted check; checkin_escalations
 * upsert/update), nothing more. `activeProjects` stands in for the real
 * query's already-filtered result -- see the describe block's own header for
 * why that filter itself isn't re-verified here. `fixtures` supplies each
 * project's already-role/status-filtered roster and daily_logs rows directly
 * -- this stub does not simulate PostgREST's own `.eq()`/`.in()` filtering
 * logic, only enough routing (by project_id) to return the right project's
 * canned data.
 */
function buildStubClient(opts: {
  activeProjects: { id: string; tenant_id: string }[]
  fixtures: Map<string, StubProjectFixture>
  failingProjectIds?: ReadonlySet<string>
  writes: StubWrite[]
}): SupabaseClient {
  const { activeProjects, fixtures, failingProjectIds, writes } = opts

  function from(table: string) {
    let projectId: string | undefined
    let engineerId: string | undefined
    let pendingUpdateStatus: string | undefined

    function resolveSelectValue(): { data: unknown; error: null } {
      if (table === 'projects') return { data: activeProjects, error: null }
      const fixture = projectId ? fixtures.get(projectId) : undefined
      if (table === 'project_members') return { data: (fixture?.roster ?? []).map((u) => ({ users: u })), error: null }
      if (table === 'daily_logs') return { data: fixture?.dailyLogs ?? [], error: null }
      return { data: [], error: null }
    }

    const builder = {
      select(_cols?: string) {
        return builder
      },
      eq(col: string, val: unknown) {
        if (col === 'project_id') projectId = val as string
        if (col === 'engineer_id') engineerId = val as string
        return builder
      },
      in(_col: string, _vals: unknown[]) {
        // Terminal for BOTH shapes this file's own code produces: a SELECT
        // chain (daily_logs's own `.in('engineer_id', ...)`) and an UPDATE
        // chain (checkin_escalations's own `.in('status', ...)` rank guard)
        // -- distinguished by whether `.update()` set pendingUpdateStatus
        // first, not by table name (both can be `daily_logs`/
        // `checkin_escalations` depending on call site).
        if (pendingUpdateStatus !== undefined) {
          const w = writes.find((x) => x.project_id === projectId && x.engineer_id === engineerId)
          if (w) w.status = pendingUpdateStatus
          return Promise.resolve({ data: null, error: null })
        }
        return Promise.resolve(resolveSelectValue())
      },
      then(onResolve: (v: { data: unknown; error: null }) => void) {
        onResolve(resolveSelectValue())
      },
      upsert(values: Record<string, unknown>, _options?: unknown) {
        const pid = values.project_id as string
        if (failingProjectIds?.has(pid)) {
          return Promise.resolve({ data: null, error: new Error('synthetic isolation-test failure') })
        }
        writes.push({
          project_id: pid,
          engineer_id: values.engineer_id as string,
          log_date: values.log_date as string,
          half: values.half as string,
          // The row's own DEFAULT (027) -- only ever changed by a
          // subsequent .update(), same as the real schema.
          status: 'awaited',
        })
        return Promise.resolve({ data: null, error: null })
      },
      update(values: Record<string, unknown>) {
        pendingUpdateStatus = values.status as string
        return builder
      },
    }
    return builder
  }

  return { from } as unknown as SupabaseClient
}

describe('runCheckinEscalationTickSweep — active-projects loop, stubbed (zero shared-DB footprint)', () => {
  it('every project the (stubbed) active-projects query returns is swept on BOTH halves', async () => {
    const PROJECT_A = 'stub-project-a'
    const PROJECT_B = 'stub-project-b'
    const engineer: StubRosterEngineer = { id: 'stub-engineer-1', full_name: 'Stub Engineer', role: 'engineer', status: 'active', whatsapp_number: '+10000000001' }
    const writes: StubWrite[] = []

    const client = buildStubClient({
      activeProjects: [
        { id: PROJECT_A, tenant_id: 'stub-tenant' },
        { id: PROJECT_B, tenant_id: 'stub-tenant' },
      ],
      fixtures: new Map([
        [PROJECT_A, { roster: [engineer], dailyLogs: [] }],
        [PROJECT_B, { roster: [engineer], dailyLogs: [] }],
      ]),
      writes,
    })

    const result = await runCheckinEscalationTickSweep(client, WRAPPER_NOW)

    expect(result.projectsSwept).toBe(2)
    expect(result.engineersConsidered).toBe(4) // 2 projects x 2 halves x 1 engineer each
    expect(result.writesAttempted).toBe(4)
    expect(result.failures).toEqual([])

    for (const projectId of [PROJECT_A, PROJECT_B]) {
      const morning = writes.find((w) => w.project_id === projectId && w.half === 'morning')
      const evening = writes.find((w) => w.project_id === projectId && w.half === 'evening')
      expect(morning?.status).toBe('escalated')
      expect(evening?.status).toBe('awaited')
    }
  })

  it('a project whose sweep fails does not prevent a LATER project from being swept, and the failure appears in the result', async () => {
    const FAIL_PROJECT = 'stub-project-fail'
    const OK_PROJECT = 'stub-project-ok'
    const engineer: StubRosterEngineer = { id: 'stub-engineer-2', full_name: 'Stub Engineer', role: 'engineer', status: 'active', whatsapp_number: '+10000000002' }
    const writes: StubWrite[] = []

    const client = buildStubClient({
      // FAIL_PROJECT listed FIRST, deliberately -- proves a project LATER in
      // the loop still runs after an earlier one fails, the direction that
      // actually matters (an earlier project surviving a LATER failure is
      // trivially true even without isolation, since the throw would only
      // ever land on the failing project's own iteration).
      activeProjects: [
        { id: FAIL_PROJECT, tenant_id: 'stub-tenant' },
        { id: OK_PROJECT, tenant_id: 'stub-tenant' },
      ],
      fixtures: new Map([
        [FAIL_PROJECT, { roster: [engineer], dailyLogs: [] }],
        [OK_PROJECT, { roster: [engineer], dailyLogs: [] }],
      ]),
      failingProjectIds: new Set([FAIL_PROJECT]),
      writes,
    })

    const result = await runCheckinEscalationTickSweep(client, WRAPPER_NOW)

    // The one that matters: OK_PROJECT's write went through untouched,
    // despite FAIL_PROJECT failing earlier in the same loop.
    const okMorning = writes.find((w) => w.project_id === OK_PROJECT && w.half === 'morning')
    const okEvening = writes.find((w) => w.project_id === OK_PROJECT && w.half === 'evening')
    expect(okMorning?.status).toBe('escalated')
    expect(okEvening?.status).toBe('awaited')

    // FAIL_PROJECT's writes genuinely failed -- no write record of any kind.
    expect(writes.some((w) => w.project_id === FAIL_PROJECT)).toBe(false)

    // Both halves failed for FAIL_PROJECT (the stub fails every upsert for
    // that project_id, not just one half) -- both must be reported, not just
    // whichever ran first.
    const failuresForFailProject = result.failures.filter((f) => f.projectId === FAIL_PROJECT)
    expect(failuresForFailProject.map((f) => f.half).sort()).toEqual(['evening', 'morning'])
    for (const f of failuresForFailProject) {
      expect(f.message).toContain('synthetic isolation-test failure')
    }
    // No failure was recorded for the project that actually succeeded.
    expect(result.failures.some((f) => f.projectId === OK_PROJECT)).toBe(false)
  })
})
