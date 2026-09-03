import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId, testPhone } from './helpers/db'
import { handleOwnerDeliverJob } from '@/lib/dpr/owner-deliver-dispatch'
import { OWNER_NO_REPORT_TEMPLATE_SID } from '@/lib/dpr/owner-no-report'
import type { EngineerDprFacts } from '@/lib/dpr/schema'
import type { SendEmailResult } from '@/lib/email/send'
import type { SendTemplateResult } from '@/lib/whatsapp/outbound/send'

// Integration tests for handleOwnerDeliverJob against REAL test-db (this
// project's own standing practice) -- ONLY the two send functions are
// injected/mocked (test/helpers/outbound-fixtures.ts's own fetchFn
// convention, applied to the sendEmailFn/sendWhatsAppFn seam this handler
// added specifically so this class of test could exist without a real
// Resend/Twilio call). Covers the batch-write fan-out AND payload
// construction through the injected send seam together, deliberately --
// both naturally live in the same test the way test/outbound-trigger.test.ts
// already combines real-DB assertions with mocked-send-call assertions.
//
// NAMED DISTINCTLY FROM test/unit/owner-deliver-dispatch.test.ts (2026-09-02).
// This file was originally test/owner-deliver-dispatch.test.ts -- the
// IDENTICAL basename as the unit-test file one directory over. Under that
// name, this file's own summary line was absent from two consecutive
// FULL-suite runs (`vitest run`, no path args) -- not failed, not errored,
// simply not printed -- while passing 10/10 every time it was run
// standalone. A SAME-BASENAME-CAUSES-THIS theory was tested directly
// (two trivial scratch files, same-basename pattern, one deliberately
// failing) and did NOT reproduce -- both lines printed correctly, the
// failure was reported. So the exact mechanism is UNCONFIRMED, not
// basename collision specifically -- full account, including why the
// leading theory doesn't hold up: docs/reviews/vitest-basename-
// collision.md. This file kept its new, distinct name regardless -- cheap
// and harmless either way, whether or not it was the actual fix.

const OWNER_EMAIL = 'zz-owner-test@example.com'
const OWNER_PHONE = testPhone('900')
const EXTRA_ENGINEER_PHONE = testPhone('901')

const VALID_FACTS: EngineerDprFacts = {
  morning_status: { status: 'complete' },
  evening_status: { status: 'complete' },
  work: {
    planned: { status: 'reported', value: 'Continue slab work' },
    done_text: { status: 'reported', value: 'Slab concrete poured' },
    done_quantity: { status: 'reported', value: 120 },
    unit: 'sqm',
  },
  schedule: { met: true },
  manpower: {
    planned: { status: 'reported', value: 20 },
    on_site: { status: 'reported', value: 18 },
    working: { status: 'reported', value: 15 },
  },
  equipment: { items: [] },
}

const VALID_STRUCTURED = {
  facts: VALID_FACTS,
  verdict: 'Good progress today.',
  morning_status: { status: 'complete' as const },
  evening_status: { status: 'complete' as const },
}

async function makeProject(ownerUserId: string, nameSuffix: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('projects')
    .insert({ tenant_id: TEST_TENANT_ID, name: `owner_deliver test project ${nameSuffix}`, status: 'active', owner_user_id: ownerUserId })
    .select('id')
    .single()
  if (error) throw new Error(`makeProject failed: ${error.message}`)
  return data.id as string
}

async function addToProject(projectId: string, engineerId: string): Promise<void> {
  const db = testClient()
  const { error } = await db
    .from('project_members')
    .insert({ tenant_id: TEST_TENANT_ID, project_id: projectId, user_id: engineerId, role: 'engineer' })
  if (error) throw new Error(`addToProject failed: ${error.message}`)
}

async function seedDailyLog(projectId: string, engineerId: string, logDate: string, eveningSubmitted: boolean): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: projectId,
      engineer_id: engineerId,
      log_date: logDate,
      morning_submitted_at: new Date().toISOString(),
      evening_submitted_at: eveningSubmitted ? new Date().toISOString() : null,
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (error) throw new Error(`seedDailyLog failed: ${error.message}`)
}

async function seedDprRow(
  projectId: string,
  engineerId: string,
  logDate: string,
  deliveryStatus: string,
  withStructured: boolean,
): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('dprs')
    .upsert(
      {
        tenant_id: TEST_TENANT_ID,
        project_id: projectId,
        engineer_id: engineerId,
        log_date: logDate,
        delivery_status: deliveryStatus,
        structured: withStructured ? (VALID_STRUCTURED as unknown as never) : null,
        content: withStructured ? 'placeholder content' : null,
        generated_at: new Date().toISOString(),
        generation_status: 'idle',
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .single()
  if (error) throw new Error(`seedDprRow failed: ${error.message}`)
  return data.id as string
}

async function readDpr(dprId: string): Promise<{ delivery_status: string; delivered_owner_at: string | null }> {
  const db = testClient()
  const { data, error } = await db.from('dprs').select('delivery_status, delivered_owner_at').eq('id', dprId).single()
  if (error) throw new Error(`readDpr failed: ${error.message}`)
  return data as { delivery_status: string; delivered_owner_at: string | null }
}

async function configureOwner(ownerId: string, opts: { whatsappNumber: string | null; verifiedEmail: boolean }): Promise<void> {
  const db = testClient()
  const { error } = await db
    .from('users')
    .update({
      whatsapp_number: opts.whatsappNumber,
      notification_email: OWNER_EMAIL,
      notification_email_verified_at: opts.verifiedEmail ? new Date().toISOString() : null,
    })
    .eq('id', ownerId)
  if (error) throw new Error(`configureOwner failed: ${error.message}`)
}

async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()
  await db.from('dprs').delete().eq('project_id', projectId)
  await db.from('daily_logs').delete().eq('project_id', projectId)
  await db.from('project_members').delete().eq('project_id', projectId)
  await db.from('projects').delete().eq('id', projectId)
}

function mockSendEmail(result: SendEmailResult) {
  const calls: unknown[] = []
  const fn = async (params: unknown) => {
    calls.push(params)
    return result
  }
  return { fn, calls }
}

function mockSendWhatsApp(result: SendTemplateResult) {
  const calls: unknown[] = []
  const fn = async (params: unknown) => {
    calls.push(params)
    return result
  }
  return { fn, calls }
}

let ownerId: string
let extraEngineerId: string

const OWNER_FULL_NAME = 'ZZ Test Owner (owner-deliver suite)'
const EXTRA_ENGINEER_FULL_NAME = 'ZZ Test Engineer 2 (owner-deliver suite)'

async function ensureUserByFullName(
  db: ReturnType<typeof testClient>,
  fullName: string,
  fields: Record<string, unknown>,
): Promise<string> {
  // Looked up by full_name -- configureOwner() below deliberately mutates
  // whatsapp_number/notification_email_verified_at per test case
  // (including back to null), so neither can be a stable idempotency key
  // across CI runs. full_name is never touched by any test in this file.
  const { data: existing } = await db.from('users').select('id').eq('full_name', fullName).maybeSingle<{ id: string }>()
  if (existing) return existing.id
  const { data, error } = await db
    .from('users')
    .insert({ tenant_id: TEST_TENANT_ID, full_name: fullName, status: 'active', auth_id: null, ...fields })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`ensureUserByFullName(${fullName}) insert failed: ${error?.message}`)
  return data.id
}

beforeAll(async () => {
  await ensureMorningFixtures()
  const db = testClient()
  ownerId = await ensureUserByFullName(db, OWNER_FULL_NAME, { role: 'owner' })
  extraEngineerId = await ensureUserByFullName(db, EXTRA_ENGINEER_FULL_NAME, {
    role: 'engineer',
    whatsapp_number: EXTRA_ENGINEER_PHONE,
    messaging_blocked: false,
  })
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('handleOwnerDeliverJob', () => {
  it('no dprs rows for this project-day -- returns cleanly, sends nothing', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const projectId = await makeProject(ownerId, 'zero-rows')
    const email = mockSendEmail({ ok: true, status: 200, id: 'em_x' })
    const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMx' })
    try {
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: '2026-09-10' },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )
      expect(result.skippedNoDprs).toBe(true)
      expect(email.calls).toHaveLength(0)
      expect(whatsapp.calls).toHaveLength(0)
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('REPORT path, verified owner: sends one email, writes delivered + delivered_owner_at', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'report-success')
    const logDate = '2026-09-11'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_report1' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMunused' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.reportSent).toBe(1)
      expect(whatsapp.calls).toHaveLength(0)
      expect(email.calls).toHaveLength(1)
      expect((email.calls[0] as { to: string }).to).toBe(OWNER_EMAIL)
      expect((email.calls[0] as { text: string }).text).toContain('Slab concrete poured')

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
      expect(row.delivered_owner_at).not.toBeNull()
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('REPORT path, provider rejects: writes owner_send_failed, not delivered', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'report-fail')
    const logDate = '2026-09-12'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: false, status: 422, errorMessage: 'bad address', responseShape: { contentType: null, bodyLength: 0, bodyHash: 'x', parsed: false } })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn },
      )

      expect(result.reportFailed).toBe(1)
      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('owner_send_failed')
      expect(row.delivered_owner_at).toBeNull()
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('REPORT path, owner not verified: skipped_unverified, email never called', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: false })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'report-unverified')
    const logDate = '2026-09-13'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn },
      )

      expect(result.reportSkippedUnverified).toBe(1)
      expect(email.calls).toHaveLength(0)
      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('skipped_unverified')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('NOTICE path, owner has WhatsApp: sends template 14 with the right SID and variables, writes no_report_sent', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'notice-whatsapp')
    const logDate = '2026-09-14'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, false)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMnotice1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.noticeSent).toBe(true)
      expect(email.calls).toHaveLength(0)
      expect(whatsapp.calls).toHaveLength(1)
      const call = whatsapp.calls[0] as { to: string; contentSid: string; contentVariables: Record<string, string> }
      expect(call.to).toBe(OWNER_PHONE)
      expect(call.contentSid).toBe(OWNER_NO_REPORT_TEMPLATE_SID)
      expect(call.contentVariables['2']).toBe('14 Sep 2026')

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('no_report_sent')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('NOTICE path, owner has NO WhatsApp but a verified email: falls back to email, writes no_report_sent', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: null, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'notice-email-fallback')
    const logDate = '2026-09-15'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, false)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_notice1' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMshould_not_be_used' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.noticeSent).toBe(true)
      expect(whatsapp.calls).toHaveLength(0)
      expect(email.calls).toHaveLength(1)
      expect((email.calls[0] as { text: string }).text).toBe(
        'No site report was received for owner_deliver test project notice-email-fallback, dated 15 Sep 2026. There is nothing to share for this date.',
      )

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('no_report_sent')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('NOTICE path, owner has neither WhatsApp nor a verified email: skipped_unverified, nothing sent', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: null, verifiedEmail: false })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'notice-unreachable')
    const logDate = '2026-09-16'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, false)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMshould_not_be_used' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.noticeSkippedUnverified).toBe(true)
      expect(email.calls).toHaveLength(0)
      expect(whatsapp.calls).toHaveLength(0)
      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('skipped_unverified')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('IDEMPOTENCY: a row already at a stage-2 terminal value is skipped -- no send, no write', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'already-terminal')
    const logDate = '2026-09-17'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'delivered', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn },
      )

      expect(result.skippedAlreadyTerminal).toBe(1)
      expect(result.reportSent).toBe(0)
      expect(email.calls).toHaveLength(0)
      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered') // unchanged
    } finally {
      await cleanupProject(projectId)
    }
  })

  // THE CORE FAN-OUT CLAIM (Decision 1, docs/reviews/owner-deliver-handler-
  // record.md): two engineers on the SAME project-day both lacking evening
  // data must produce exactly ONE real WhatsApp send, not two -- with the
  // SAME outcome written to BOTH rows from that one send. This is the
  // literal resolution to 034's own PROPAGATION GAP note ("the no-report
  // notice is sent ONCE per owner per project-day; dprs rows are per
  // engineer... something must resolve which N before any UPDATE runs").
  it('FAN-OUT: two notice-routed engineers on one project-day produce exactly ONE WhatsApp send, written to BOTH rows', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'fan-out-notice')
    const logDate = '2026-09-18'
    try {
      await addToProject(projectId, engineerId)
      await addToProject(projectId, extraEngineerId)
      // Both engineers lack evening data -- both must route to 'notice'.
      await seedDailyLog(projectId, engineerId, logDate, false)
      await seedDailyLog(projectId, extraEngineerId, logDate, false)
      const dprId1 = await seedDprRow(projectId, engineerId, logDate, 'pending', false)
      const dprId2 = await seedDprRow(projectId, extraEngineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMfanout1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.noticeSent).toBe(true)
      // THE ASSERTION THAT MATTERS: exactly one send call, not two, despite
      // two eligible notice-routed rows.
      expect(whatsapp.calls).toHaveLength(1)
      expect(email.calls).toHaveLength(0)

      const row1 = await readDpr(dprId1)
      const row2 = await readDpr(dprId2)
      expect(row1.delivery_status).toBe('no_report_sent')
      expect(row2.delivery_status).toBe('no_report_sent')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('MIXED project-day: one engineer reports, one has no data -- one email AND one notice, each written only to its own row', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'mixed-day')
    const logDate = '2026-09-19'
    try {
      await addToProject(projectId, engineerId)
      await addToProject(projectId, extraEngineerId)
      await seedDailyLog(projectId, engineerId, logDate, true) // reports
      await seedDailyLog(projectId, extraEngineerId, logDate, false) // no report
      const reportDprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)
      const noticeDprId = await seedDprRow(projectId, extraEngineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_mixed1' })
      const whatsapp = mockSendWhatsApp({ ok: true, status: 200, sid: 'SMmixed1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, sendWhatsAppFn: whatsapp.fn },
      )

      expect(result.reportSent).toBe(1)
      expect(result.noticeSent).toBe(true)
      expect(email.calls).toHaveLength(1)
      expect(whatsapp.calls).toHaveLength(1)

      const reportRow = await readDpr(reportDprId)
      const noticeRow = await readDpr(noticeDprId)
      expect(reportRow.delivery_status).toBe('delivered')
      expect(noticeRow.delivery_status).toBe('no_report_sent')
    } finally {
      await cleanupProject(projectId)
    }
  })
})
