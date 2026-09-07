// Migration 038 test-db rehearsal — ONE executable script, per Aravind's own
// instruction, replacing the nine-step manual plan in docs/reviews/038-
// test-db-rehearsal-plan.md. Runs pre-flight, applies 038, all four probes
// the reviewer named plus Scenario 5, then the DOWN (which both verifies
// the rollback AND restores test-db to its exact pre-rehearsal baseline —
// deliberately the LAST phase before teardown/diff, not a separate re-apply
// step), then confirms the baseline (including COMMENT text, per CLAUDE.md's
// "A TEARDOWN VERIFIES COMMENTS TOO" rule, PR #212) and the jobs ledger are
// both untouched.
//
// WHY A DIRECT POSTGRES CONNECTION, NOT THE SUPABASE JS CLIENT: every other
// script in this codebase goes through PostgREST (createClient + .rpc()),
// which cannot do SET ROLE, transaction-scoped rollback, or raw catalog
// queries (has_function_privilege, obj_description, pg_stat_activity) at
// all — PostgREST has no surface for any of them. This is the first script
// in this codebase to use `pg` directly; added as a devDependency for
// exactly this reason.
//
// SAFETY, STATED PRECISELY: this script reads credentials from .env.local
// and NEVER prints them. It does not use `supabase --linked` state at any
// point — that state defaults to PROD in this repo (supabase/.temp/
// project-ref) and Aravind explicitly does not want a prod-pointed run
// possible by accident. Instead, the target project ref is parsed directly
// out of the connection string itself (the only thing that actually
// determines which database gets touched) and checked against the literal
// string 'exfccwlrhoutkgrlikod' before a single query runs. Every fixture
// row this script creates uses a "ZZ-REHEARSAL-038-" prefix and is deleted
// in its own teardown phase — nothing here depends on any other test
// suite's fixtures being present.
//
// STOPS ON THE FIRST UNEXPECTED RESULT. Every phase asserts its own
// expected outcome explicitly; a mismatch throws immediately rather than
// continuing into a probe that assumes an untested prior state.
//
// Run: npx tsx scripts/rehearse-038.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'

const EXPECTED_PROJECT_REF = 'exfccwlrhoutkgrlikod'
const MIGRATION_PATH = join(process.cwd(), 'docs/reviews/038_hindrance_flow_and_collision_fix.sql')

const REHEARSAL_TENANT_A = '00000000-eeee-4000-a000-000000000a01'
const REHEARSAL_PROJECT_A = '00000000-eeee-4000-a000-000000000a02'
const REHEARSAL_ENGINEER_A = '00000000-eeee-4000-a000-000000000a03'
const REHEARSAL_TENANT_B = '00000000-eeee-4000-a000-000000000b01'
const REHEARSAL_PROJECT_B = '00000000-eeee-4000-a000-000000000b02'
const REHEARSAL_PHONE_MORNING = '+910000eeee01'
const REHEARSAL_PHONE_DOWN = '+910000eeee02'

function marker(label: string): void {
  console.log(`\n${'='.repeat(78)}\n=== ${label}\n${'='.repeat(78)}`)
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n!!! ASSERTION FAILED: ${message}\n`)
    throw new Error(`Rehearsal stopped: ${message}`)
  }
  console.log(`ok: ${message}`)
}

// Parses a Supabase project ref out of either connection-string shape:
//   postgresql://postgres:[pw]@db.<ref>.supabase.co:5432/postgres          (direct)
//   postgresql://postgres.<ref>:[pw]@aws-0-<region>.pooler.supabase.com:*  (pooler)
// Uses a real URL parse (not two brittle regexes over the raw string) so
// this is robust to a missing password, unusual encoding, or a query
// string -- any of which would break a naive regex silently.
function parseProjectRef(connectionString: string): string | null {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return null
  }
  // Pooler form: username is "postgres.<ref>".
  const usernamePart = decodeURIComponent(url.username)
  const usernameMatch = usernamePart.match(/^postgres\.([a-z0-9]+)$/)
  if (usernameMatch) return usernameMatch[1]
  // Direct form: host is "db.<ref>.supabase.co".
  const hostMatch = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)
  if (hostMatch) return hostMatch[1]
  return null
}

async function main() {
  const connectionString = process.env.SUPABASE_TEST_DB_URL
  if (!connectionString) {
    console.error(
      [
        'rehearse-038: SUPABASE_TEST_DB_URL is not set in .env.local.',
        '',
        'This must be a full Postgres connection string for test-db',
        `(project ${EXPECTED_PROJECT_REF}), e.g.:`,
        '  postgresql://postgres.exfccwlrhoutkgrlikod:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres',
        '',
        'Get it from the Supabase dashboard -> test-db project -> Settings -> Database -> Connection string.',
        'Add it to .env.local as SUPABASE_TEST_DB_URL=... — never printed by this script, never committed.',
      ].join('\n'),
    )
    process.exit(1)
  }

  const parsedRef = parseProjectRef(connectionString)

  marker('PROJECT REF CHECK — must equal ' + EXPECTED_PROJECT_REF + ' or this script aborts')
  console.log(`Parsed project ref from SUPABASE_TEST_DB_URL: ${parsedRef ?? '(could not parse)'}`)

  if (parsedRef !== EXPECTED_PROJECT_REF) {
    console.error(
      `\n!!! ABORT: connection string does not resolve to ${EXPECTED_PROJECT_REF}. ` +
        `Got "${parsedRef}". Refusing to run — this is exactly the accidental-prod-run this check exists to prevent.\n`,
    )
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    marker('CONNECTED — current_database() and now(), same output as the ref check above')
    const dbInfo = await client.query('SELECT current_database() AS db, now() AS checked_at;')
    console.log(dbInfo.rows)

    // ---------------------------------------------------------------------
    marker('PRE-FLIGHT 0a — pg_stat_activity: confirm no other agent/test run is in flight')
    const activity = await client.query(
      `SELECT pid, usename, application_name, client_addr, state, query_start, state_change,
              left(query, 120) AS query_snippet
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
        ORDER BY query_start;`,
    )
    // Classify, don't just dump -- a real rehearsal run (2026-09-07) showed
    // 8 rows that were ALL Supabase's own always-on infrastructure
    // (PostgREST, pg_cron, postgres_exporter, pg_net), which is normal
    // background noise on every Supabase project, not a contention signal.
    // Printing all 8 undifferentiated made a human re-derive that by eye
    // every single run -- this classifies known infrastructure by usename/
    // application_name and buckets everything else separately, so only the
    // OTHER bucket needs actual review. Named patterns are this session's
    // best understanding of Supabase's own connection identities, not
    // independently verified against Supabase's own docs -- if a future
    // run shows a genuine infrastructure connection landing in OTHER,
    // extend KNOWN_INFRA_USENAMES/KNOWN_INFRA_APP_NAMES rather than assume
    // the check is wrong.
    const KNOWN_INFRA_USENAMES = new Set(['supabase_admin', 'authenticator', 'pgbouncer', 'supabase_realtime_admin', 'supabase_storage_admin'])
    const KNOWN_INFRA_APP_NAME_PATTERNS = [/postgrest/i, /pg_cron/i, /postgres_exporter/i, /pg_net/i, /supavisor/i, /realtime/i]
    type ActivityRow = { pid: number; usename: string | null; application_name: string | null; [key: string]: unknown }
    const isKnownInfra = (row: ActivityRow): boolean =>
      (row.usename !== null && KNOWN_INFRA_USENAMES.has(row.usename)) ||
      (row.application_name !== null && KNOWN_INFRA_APP_NAME_PATTERNS.some((p) => p.test(row.application_name as string)))

    const infraRows = activity.rows.filter(isKnownInfra)
    const otherRows = activity.rows.filter((r: ActivityRow) => !isKnownInfra(r))

    console.log(`Known Supabase infrastructure (${infraRows.length}, informational only):`)
    console.log(infraRows.map((r: ActivityRow) => ({ usename: r.usename, application_name: r.application_name, state: r.state })))
    console.log(`\nOTHER connections (${otherRows.length}) — these need real review, not infrastructure noise:`)
    console.log(otherRows)
    assert(otherRows.length === 0, 'no non-infrastructure connections found — rehearsal isolation looks clean')

    // ---------------------------------------------------------------------
    marker('PRE-FLIGHT 0c — GATING QUESTION: is test-db at 036/037, or behind prod?')
    const ledger = await client.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`)
    const versions: string[] = ledger.rows.map((r: { version: string }) => r.version)
    console.log('Full raw ledger:', versions)
    const has036 = versions.some((v) => v.startsWith('036'))
    const has037 = versions.some((v) => v.startsWith('037'))
    const has038 = versions.some((v) => v.startsWith('038'))
    console.log({ has036, has037, has038_already_applied: has038 })

    if (!has036 || !has037) {
      console.error(
        '\n!!! STOPPING: test-db does not show 036/037 in its own ledger. ' +
          'Rehearsing 038 on top of this schema would be the same problem as the 035 incident. ' +
          'Resolve the ledger gap before re-running this script.\n',
      )
      process.exit(1)
    }
    if (has038) {
      console.error('\n!!! STOPPING: 038 already appears applied on test-db. Investigate before re-running this script.\n')
      process.exit(1)
    }
    console.log('Ledger check passed: 036 and 037 present, 038 absent. Proceeding.')

    // ---------------------------------------------------------------------
    marker('PRE-FLIGHT 0b — baseline capture (for the post-teardown diff)')
    const baselineComments = await client.query(
      `SELECT proname, obj_description(oid, 'pg_proc') AS comment
         FROM pg_proc
        WHERE proname IN ('apply_hindrance_flow_turn','apply_morning_flow_turn','apply_evening_flow_turn')
        ORDER BY proname;`,
    )
    console.log('Function comments (expect apply_hindrance_flow_turn absent — not created yet):', baselineComments.rows)

    const baselineColumnComments = await client.query(
      `SELECT column_name, col_description('hindrances'::regclass, ordinal_position) AS comment
         FROM information_schema.columns
        WHERE table_name = 'hindrances' AND column_name IN ('timing','timing_raw')
        ORDER BY column_name;`,
    )
    console.log('hindrances.timing/timing_raw comments:', baselineColumnComments.rows)

    const baselineFks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'hindrances'::regclass AND contype = 'f'
        ORDER BY conname;`,
    )
    console.log('hindrances FKs (expect plain, single-column):', baselineFks.rows)

    const baselineJobs = await client.query('SELECT count(*)::int AS n FROM jobs;')
    const baselineJobCount: number = baselineJobs.rows[0].n
    console.log('jobs table baseline count:', baselineJobCount)

    // ---------------------------------------------------------------------
    marker('PHASE 1 — APPLY migration 038')
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8')
    await client.query(migrationSql)
    console.log('Applied without error.')

    const postApplyFks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'hindrances'::regclass AND contype = 'f'
        ORDER BY conname;`,
    )
    console.log('hindrances FKs post-apply (expect composite, both referencing (id, tenant_id)):', postApplyFks.rows)
    // Named check on the two specific constraints this migration touches --
    // NOT a blanket "does any definition contain tenant_id" check, which
    // would trivially pass regardless of the fix: hindrances_tenant_id_fkey
    // itself ALWAYS contains "tenant_id" in its own definition (it's that
    // FK's own column name), found by actually running this and seeing the
    // assertion behave oddly, not assumed.
    const projectFk = postApplyFks.rows.find((r: { conname: string }) => r.conname === 'hindrances_project_id_fkey')
    const reportedByFk = postApplyFks.rows.find((r: { conname: string }) => r.conname === 'hindrances_reported_by_fkey')
    assert(!!projectFk?.definition.includes('project_id, tenant_id'), 'hindrances_project_id_fkey is composite post-apply')
    assert(!!reportedByFk?.definition.includes('reported_by, tenant_id'), 'hindrances_reported_by_fkey is composite post-apply')

    // ---------------------------------------------------------------------
    marker('PHASE 2 — PROBE 1: service_role negative-capability (anon/authenticated must NOT have EXECUTE)')
    const priv = await client.query(`
      SELECT
        has_function_privilege('anon', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS anon_hindrance,
        has_function_privilege('authenticated', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS authenticated_hindrance,
        has_function_privilege('service_role', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS service_role_hindrance,
        has_function_privilege('anon', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE') AS anon_morning,
        has_function_privilege('service_role', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE') AS service_role_morning,
        has_function_privilege('anon', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE') AS anon_evening,
        has_function_privilege('service_role', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE') AS service_role_evening;
    `)
    console.log(priv.rows[0])
    const p = priv.rows[0]
    assert(p.anon_hindrance === false, 'anon cannot EXECUTE apply_hindrance_flow_turn')
    assert(p.authenticated_hindrance === false, 'authenticated cannot EXECUTE apply_hindrance_flow_turn')
    assert(p.service_role_hindrance === true, 'service_role CAN EXECUTE apply_hindrance_flow_turn')
    assert(p.anon_morning === false, 'anon cannot EXECUTE apply_morning_flow_turn')
    assert(p.service_role_morning === true, 'service_role CAN EXECUTE apply_morning_flow_turn')
    assert(p.anon_evening === false, 'anon cannot EXECUTE apply_evening_flow_turn')
    assert(p.service_role_evening === true, 'service_role CAN EXECUTE apply_evening_flow_turn')

    // ---------------------------------------------------------------------
    marker('PHASE 3 — PROBE 2: live anon-key call, raw 42501 (SET ROLE, not the API key)')
    const anonFns: Array<[string, string]> = [
      ['apply_hindrance_flow_turn', `apply_hindrance_flow_turn('+910000000000', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'test', true)`],
      [
        'apply_morning_flow_turn',
        `apply_morning_flow_turn('+910000000000', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'test', true)`,
      ],
      [
        'apply_evening_flow_turn',
        `apply_evening_flow_turn('+910000000000', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'test', true)`,
      ],
    ]
    for (const [name, call] of anonFns) {
      await client.query('BEGIN');
      await client.query('SET ROLE anon');
      let assertionError: unknown = null
      try {
        await client.query(`SELECT ${call};`)
        assertionError = new Error(`anon was able to call ${name} — expected 42501, got no error at all`)
      } catch (err) {
        const pgErr = err as { code?: string; message?: string }
        console.log(`${name}: code=${pgErr.code} message="${pgErr.message}"`)
        if (pgErr.code !== '42501') {
          assertionError = new Error(`${name}: expected 42501, got code=${pgErr.code}`)
        }
      } finally {
        // ROLLBACK alone reverts SET ROLE too -- any SET issued inside an
        // explicit transaction block is undone by ROLLBACK regardless of
        // LOCAL, so a separate RESET ROLE is not just unneeded but actively
        // wrong here: issuing it AFTER a failed query, while the
        // transaction is still aborted, itself raises "current transaction
        // is aborted" and skips the ROLLBACK below entirely — found by
        // actually running this against a real Postgres instance, not
        // assumed. ROLLBACK is always safe to call on an aborted transaction.
        await client.query('ROLLBACK');
      }
      if (assertionError) throw assertionError
      console.log(`ok: ${name} raised 42501 (permission denied) for anon`)
    }

    // ---------------------------------------------------------------------
    marker('PHASE 4 — PROBE 4: composite-FK behavioural probe, real cross-tenant INSERT, raw 23503')
    await client.query('BEGIN')
    await client.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'ZZ-REHEARSAL-038-Tenant-A', 'zz-rehearsal-038-a') ON CONFLICT (id) DO NOTHING`, [
      REHEARSAL_TENANT_A,
    ])
    await client.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'ZZ-REHEARSAL-038-Tenant-B', 'zz-rehearsal-038-b') ON CONFLICT (id) DO NOTHING`, [
      REHEARSAL_TENANT_B,
    ])
    await client.query(`INSERT INTO projects (id, tenant_id, name) VALUES ($1, $2, 'ZZ-REHEARSAL-038-Project-A') ON CONFLICT (id) DO NOTHING`, [
      REHEARSAL_PROJECT_A,
      REHEARSAL_TENANT_A,
    ])
    await client.query(`INSERT INTO projects (id, tenant_id, name) VALUES ($1, $2, 'ZZ-REHEARSAL-038-Project-B') ON CONFLICT (id) DO NOTHING`, [
      REHEARSAL_PROJECT_B,
      REHEARSAL_TENANT_B,
    ])
    await client.query('COMMIT')
    console.log('Rehearsal tenants/projects A and B created.')

    await client.query('BEGIN')
    try {
      await client.query(
        `INSERT INTO hindrances (tenant_id, project_id, reported_by, description, submitted_via)
         VALUES ($1, $2, $3, 'ZZ-REHEARSAL cross-tenant probe', 'whatsapp_adhoc')`,
        [REHEARSAL_TENANT_A, REHEARSAL_PROJECT_B, REHEARSAL_ENGINEER_A],
      )
      console.error('\n!!! ASSERTION FAILED: cross-tenant insert did NOT raise an error\n')
      throw new Error('cross-tenant insert succeeded — composite FK is not working')
    } catch (err) {
      const pgErr = err as { code?: string; message?: string }
      console.log(`code=${pgErr.code} message="${pgErr.message}"`)
      assert(pgErr.code === '23503', 'cross-tenant insert raised 23503 (foreign_key_violation)')
    } finally {
      await client.query('ROLLBACK')
    }

    // ---------------------------------------------------------------------
    marker('PHASE 5 — Scenario 5: real morning submission -> hindrance abandon -> force-reset, real test-db')
    await client.query(
      `INSERT INTO users (id, tenant_id, auth_id, full_name, role, status, messaging_blocked, whatsapp_number)
       VALUES ($1, $2, NULL, 'ZZ Rehearsal Engineer A', 'engineer', 'active', false, $3)
       ON CONFLICT (id) DO NOTHING`,
      [REHEARSAL_ENGINEER_A, REHEARSAL_TENANT_A, REHEARSAL_PHONE_MORNING],
    )
    await client.query(
      `INSERT INTO project_members (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'engineer') ON CONFLICT DO NOTHING`,
      [REHEARSAL_TENANT_A, REHEARSAL_PROJECT_A, REHEARSAL_ENGINEER_A],
    )

    const morningCommon = [REHEARSAL_PHONE_MORNING, REHEARSAL_TENANT_A, REHEARSAL_ENGINEER_A, REHEARSAL_PROJECT_A]
    async function morningTurn(sql: string, params: unknown[]): Promise<unknown> {
      const r = await client.query(sql, params)
      return r.rows[0].result
    }
    async function hindranceTurn(message: string, startFlow: boolean, timing: string | null = null, timingOk: boolean | null = null): Promise<unknown> {
      const r = await client.query(
        `SELECT apply_hindrance_flow_turn($1, $2, $3, $4, $5, $6, $7, $8) AS result`,
        [REHEARSAL_PHONE_MORNING, REHEARSAL_TENANT_A, REHEARSAL_ENGINEER_A, REHEARSAL_PROJECT_A, message, startFlow, timing, timingOk],
      )
      return r.rows[0].result
    }

    console.log(
      'start:',
      await morningTurn(`SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6) AS result`, [...morningCommon, '', true]),
    )
    console.log(
      'q1 (yes):',
      await morningTurn(`SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6) AS result`, [...morningCommon, 'yes', false]),
    )
    console.log(
      'q2 (plan):',
      await morningTurn(`SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6) AS result`, [
        ...morningCommon,
        'rehearsal plan text',
        false,
      ]),
    )
    console.log(
      'q3 (manpower):',
      await morningTurn(
        `SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6, $7::jsonb, $8) AS result`,
        [...morningCommon, '20 workers', false, '{}', true],
      ),
    )
    console.log(
      'q4 (equipment, COMPLETES):',
      await morningTurn(
        `SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6, NULL, NULL, $7::jsonb, $8) AS result`,
        [...morningCommon, 'crane, mixer', false, '{}', true],
      ),
    )

    const dailyLogAfterReal = await client.query(
      `SELECT attendance, attendance_raw, morning_submitted_at FROM daily_logs WHERE project_id = $1 AND engineer_id = $2`,
      [REHEARSAL_PROJECT_A, REHEARSAL_ENGINEER_A],
    )
    console.log('daily_logs after REAL submission:', dailyLogAfterReal.rows)
    assert(dailyLogAfterReal.rows[0]?.attendance === 'present', 'real submission recorded attendance=present')

    console.log('hindrance start:', await hindranceTurn('1', true))
    console.log('hindrance q1 (abandon at Q2):', await hindranceTurn('rehearsal hindrance description', false))

    const sessionMidHindrance = await client.query(`SELECT current_flow, current_step, context FROM whatsapp_sessions WHERE phone_number = $1`, [
      REHEARSAL_PHONE_MORNING,
    ])
    console.log('session mid-hindrance:', sessionMidHindrance.rows)

    console.log(
      'FORCE-RESET (scheduled trigger simulation):',
      await morningTurn(`SELECT apply_morning_flow_turn($1, $2, $3, $4, $5, $6) AS result`, [...morningCommon, '', true]),
    )

    const dailyLogAfterForceReset = await client.query(
      `SELECT attendance, attendance_raw, morning_submitted_at FROM daily_logs WHERE project_id = $1 AND engineer_id = $2`,
      [REHEARSAL_PROJECT_A, REHEARSAL_ENGINEER_A],
    )
    console.log('daily_logs after force-reset (must be UNCHANGED — this is the B1 fix):', dailyLogAfterForceReset.rows)
    assert(dailyLogAfterForceReset.rows[0]?.attendance === 'present', 'B1 FIX HOLDS: real attendance still present after collision')
    assert(
      // pg returns TIMESTAMPTZ as a Date object -- compare by value
      // (getTime()), never by reference (===), which would always be
      // false for two separately-fetched Date instances even when they
      // represent the identical moment. Found by actually running this,
      // not assumed: the two printed values above were visibly identical
      // and the === comparison still failed.
      new Date(dailyLogAfterForceReset.rows[0]?.morning_submitted_at).getTime() ===
        new Date(dailyLogAfterReal.rows[0]?.morning_submitted_at).getTime(),
      'B1 FIX HOLDS: morning_submitted_at unchanged (no bogus second write)',
    )

    const sessionAfterForceReset = await client.query(`SELECT current_flow, current_step, context FROM whatsapp_sessions WHERE phone_number = $1`, [
      REHEARSAL_PHONE_MORNING,
    ])
    console.log('session after force-reset:', sessionAfterForceReset.rows)
    assert(sessionAfterForceReset.rows[0]?.current_flow === null, 'session correctly idle (already_complete), not restarted into morning')

    // ---------------------------------------------------------------------
    marker('PHASE 6 — PROBE 3: DOWN block, live in-flight session, real test-db (this ALSO restores baseline)')
    await client.query(
      `INSERT INTO whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, pending_flows, expires_at, updated_at)
       VALUES ($1, $2, $3, 'hindrance', 2, $4::jsonb, '[]'::jsonb, now() + interval '30 minutes', now())
       ON CONFLICT (phone_number) DO UPDATE SET current_flow = EXCLUDED.current_flow, current_step = EXCLUDED.current_step,
         context = EXCLUDED.context, pending_flows = EXCLUDED.pending_flows, updated_at = EXCLUDED.updated_at`,
      [REHEARSAL_PHONE_DOWN, REHEARSAL_TENANT_A, REHEARSAL_ENGINEER_A, JSON.stringify({ description: 'down rehearsal seed', q2_reask: 1, morning_submitted: true })],
    )
    console.log('Live in-flight hindrance session seeded, carrying morning_submitted: true.')

    const downSql = extractDownBlock(migrationSql)
    console.log(`Extracted DOWN block (${downSql.split('\n').length} lines). Running it now.`)
    await client.query(downSql)
    console.log('DOWN applied without error.')

    const sessionAfterDown = await client.query(`SELECT current_flow, current_step, context FROM whatsapp_sessions WHERE phone_number = $1`, [
      REHEARSAL_PHONE_DOWN,
    ])
    console.log('session after DOWN:', sessionAfterDown.rows)
    assert(sessionAfterDown.rows[0]?.current_flow === null, 'DOWN cleared the session to idle')
    assert(
      JSON.stringify(sessionAfterDown.rows[0]?.context) === JSON.stringify({ morning_submitted: true }),
      'DOWN preserved morning_submitted via subtract-only sweep',
    )

    const fnAfterDown = await client.query(`SELECT proname FROM pg_proc WHERE proname = 'apply_hindrance_flow_turn';`)
    assert(fnAfterDown.rows.length === 0, 'apply_hindrance_flow_turn dropped by DOWN')

    const fksAfterDown = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'hindrances'::regclass AND contype = 'f'
        ORDER BY conname;`,
    )
    console.log('hindrances FKs after DOWN (expect plain again):', fksAfterDown.rows)
    // Same named-constraint check as the post-apply assertion above --
    // hindrances_tenant_id_fkey's own definition always contains
    // "tenant_id" regardless of the other two constraints' shape.
    const projectFkAfterDown = fksAfterDown.rows.find((r: { conname: string }) => r.conname === 'hindrances_project_id_fkey')
    const reportedByFkAfterDown = fksAfterDown.rows.find((r: { conname: string }) => r.conname === 'hindrances_reported_by_fkey')
    assert(!!projectFkAfterDown && !projectFkAfterDown.definition.includes('tenant_id'), 'hindrances_project_id_fkey reverted to plain single-column')
    assert(
      !!reportedByFkAfterDown && !reportedByFkAfterDown.definition.includes('tenant_id'),
      'hindrances_reported_by_fkey reverted to plain single-column',
    )

    // ---------------------------------------------------------------------
    marker('PHASE 7 — TEARDOWN: remove every rehearsal row')
    await client.query(`DELETE FROM whatsapp_sessions WHERE phone_number IN ($1, $2)`, [REHEARSAL_PHONE_MORNING, REHEARSAL_PHONE_DOWN])
    await client.query(`DELETE FROM daily_logs WHERE project_id = $1 AND engineer_id = $2`, [REHEARSAL_PROJECT_A, REHEARSAL_ENGINEER_A])
    await client.query(`DELETE FROM hindrances WHERE description LIKE 'ZZ-REHEARSAL%' OR description = 'rehearsal hindrance description'`)
    await client.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [REHEARSAL_PROJECT_A, REHEARSAL_ENGINEER_A])
    await client.query(`DELETE FROM users WHERE id = $1`, [REHEARSAL_ENGINEER_A])
    await client.query(`DELETE FROM projects WHERE id IN ($1, $2)`, [REHEARSAL_PROJECT_A, REHEARSAL_PROJECT_B])
    await client.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [REHEARSAL_TENANT_A, REHEARSAL_TENANT_B])
    console.log('All rehearsal rows removed.')

    marker('PHASE 8 — BASELINE DIFF, including COMMENT text (PR #212)')
    const finalComments = await client.query(
      `SELECT proname, obj_description(oid, 'pg_proc') AS comment
         FROM pg_proc
        WHERE proname IN ('apply_hindrance_flow_turn','apply_morning_flow_turn','apply_evening_flow_turn')
        ORDER BY proname;`,
    )
    console.log('Function comments now:', finalComments.rows)
    assert(JSON.stringify(finalComments.rows) === JSON.stringify(baselineComments.rows), 'function comments byte-identical to pre-flight baseline')

    const finalColumnComments = await client.query(
      `SELECT column_name, col_description('hindrances'::regclass, ordinal_position) AS comment
         FROM information_schema.columns
        WHERE table_name = 'hindrances' AND column_name IN ('timing','timing_raw')
        ORDER BY column_name;`,
    )
    console.log('hindrances.timing/timing_raw comments now:', finalColumnComments.rows)
    assert(
      JSON.stringify(finalColumnComments.rows) === JSON.stringify(baselineColumnComments.rows),
      'column comments byte-identical to pre-flight baseline',
    )

    const finalFks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'hindrances'::regclass AND contype = 'f'
        ORDER BY conname;`,
    )
    assert(JSON.stringify(finalFks.rows) === JSON.stringify(baselineFks.rows), 'hindrances FKs byte-identical to pre-flight baseline')

    marker('PHASE 9 — LEDGER CONFIRMATION')
    const finalJobs = await client.query('SELECT count(*)::int AS n FROM jobs;')
    console.log('jobs count now:', finalJobs.rows[0].n, '| baseline was:', baselineJobCount)
    assert(finalJobs.rows[0].n === baselineJobCount, 'jobs table row count unchanged — this rehearsal enqueued nothing')

    marker('REHEARSAL COMPLETE — ALL ASSERTIONS PASSED')
    console.log('Test-db is at its exact pre-flight baseline. Nothing left behind.')
  } finally {
    await client.end()
  }
}

// Extracts the DOWN block from the migration file's own commented-out
// section (from "-- BEGIN;" through "-- COMMIT;") and strips the leading
// "-- " comment prefix from every line, matching this file's own established
// convention (036/037/038's own DOWN sections are all fully commented out —
// see scripts/lint-migrations.mjs's down-section-must-be-commented rule).
function extractDownBlock(migrationSql: string): string {
  const lines = migrationSql.split('\n')
  const startIdx = lines.findIndex((l) => l.trim() === '-- BEGIN;')
  const endIdx = lines.findIndex((l) => l.trim() === '-- COMMIT;')
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('extractDownBlock: could not find "-- BEGIN;" / "-- COMMIT;" markers in the migration file')
  }
  return lines
    .slice(startIdx, endIdx + 1)
    .map((l) => l.replace(/^-- ?/, ''))
    .join('\n')
}

main().catch((err) => {
  console.error('\nREHEARSAL STOPPED —', err instanceof Error ? err.message : err)
  process.exit(1)
})
