import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures, testEngineerId, testPhone } from './helpers/db'
import { handleOwnerDeliverJob } from '@/lib/dpr/owner-deliver-dispatch'
import { OWNER_NO_REPORT_TEMPLATE_SID } from '@/lib/dpr/owner-no-report'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import type { EngineerDprFacts } from '@/lib/dpr/schema'
import type { SendEmailResult } from '@/lib/email/send'
import type { SendTemplateResult } from '@/lib/whatsapp/outbound/send'

// F1/F2 (2026-09-16): same @sentry/nextjs mocking convention as
// test/unit/project-manager.test.ts and test/dpr-photo-selection.test.ts
// (vi.hoisted + importOriginal, only capture* replaced) -- named-export
// mutation under ESM requires this shape, vi.spyOn cannot redefine it.
const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }))
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  return { ...actual, captureMessage: captureMessageMock }
})

// F1 -- same monkey-patch-the-shared-client spy as test/dpr-photo-
// selection.test.ts's own withDownloadSpy; duplicated rather than shared
// because these two files deliberately test at different layers
// (selectDprPhotos directly vs. the full handleOwnerDeliverJob pipeline)
// and neither imports the other's helpers.
function withDownloadSpy(db: SupabaseClient) {
  let calls = 0
  const originalFrom = db.storage.from.bind(db.storage)
  db.storage.from = ((bucket: string) => {
    const api = originalFrom(bucket)
    const originalDownload = api.download.bind(api)
    api.download = ((...args: Parameters<typeof api.download>) => {
      calls++
      return originalDownload(...args)
    }) as typeof api.download
    return api
  }) as typeof db.storage.from
  return {
    getCalls: () => calls,
    restore: () => {
      db.storage.from = originalFrom
    },
  }
}

async function breakPhoto(objectPath: string): Promise<void> {
  const db = testClient()
  const { error } = await db.storage.from(PHOTO_BUCKET).remove([objectPath])
  if (error) throw new Error(`breakPhoto failed: ${error.message}`)
}

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
    planned_corrected: { status: 'reported', value: 'Continue slab work' },
    done_text_corrected: { status: 'reported', value: 'Slab concrete poured' },
  },
  tomorrowNeeds: { note: { status: 'not_captured', value: null } },
  manpower: {
    planned: { status: 'reported', value: '20 workers' },
    on_site: { status: 'reported', value: '18 workers' },
  },
  idle_hours_by_trade: [],
  equipment: { items: [], machines_reported: { status: 'not_captured', value: null }, run_hours: { status: 'not_captured', value: null } },
  hindrances: [],
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

// --- Stage 4 (DPR photo attachments, S1-S7) fixture helpers ----------

const uploadedTestPhotoPaths: string[] = []

async function getDailyLogId(projectId: string, engineerId: string, logDate: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .select('id')
    .eq('project_id', projectId)
    .eq('engineer_id', engineerId)
    .eq('log_date', logDate)
    .single<{ id: string }>()
  if (error || !data) throw new Error(`getDailyLogId failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function setEveningPhotosStatus(dailyLogId: string, status: 'pending' | 'complete' | 'failed' | null): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').update({ evening_photos_status: status }).eq('id', dailyLogId)
  if (error) throw new Error(`setEveningPhotosStatus failed: ${error.message}`)
}

async function seedEveningPhoto(dailyLogId: string, sizeBytes = 16): Promise<string> {
  const db = testClient()
  const objectPath = `${TEST_TENANT_ID}/owner-deliver-test/${randomUUID()}.jpg`
  const { error: uploadError } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(objectPath, Buffer.from(new Uint8Array(sizeBytes).fill(1)), { contentType: 'image/jpeg' })
  if (uploadError) throw new Error(`seedEveningPhoto upload failed: ${uploadError.message}`)
  uploadedTestPhotoPaths.push(objectPath)
  const { error } = await db
    .from('daily_log_photos')
    .insert({ tenant_id: TEST_TENANT_ID, daily_log_id: dailyLogId, phase: 'evening', photo_url: objectPath, retention_class: 'evening_progress' })
  if (error) throw new Error(`seedEveningPhoto insert failed: ${error.message}`)
  return objectPath
}

async function seedHindranceWithPhoto(
  projectId: string,
  reportedBy: string,
  logDate: string,
  photosStatus: 'pending' | 'complete' | 'failed' | null = 'complete',
): Promise<{ hindranceId: string; photoPath: string }> {
  const db = testClient()
  const { data: hindrance, error: hErr } = await db
    .from('hindrances')
    .insert({
      tenant_id: TEST_TENANT_ID,
      project_id: projectId,
      reported_by: reportedBy,
      description: 'ZZ owner-deliver-job photo test hindrance',
      timing: 'active',
      submitted_via: 'whatsapp_adhoc',
      created_at: `${logDate}T10:00:00+05:30`,
      photos_status: photosStatus,
    })
    .select('id')
    .single<{ id: string }>()
  if (hErr || !hindrance) throw new Error(`seedHindranceWithPhoto insert failed: ${hErr?.message ?? 'no row'}`)

  const objectPath = `${TEST_TENANT_ID}/owner-deliver-test/${randomUUID()}.jpg`
  const { error: uploadError } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(objectPath, Buffer.from(new Uint8Array(16).fill(2)), { contentType: 'image/jpeg' })
  if (uploadError) throw new Error(`seedHindranceWithPhoto upload failed: ${uploadError.message}`)
  uploadedTestPhotoPaths.push(objectPath)
  const { error: photoError } = await db
    .from('hindrance_photos')
    .insert({ tenant_id: TEST_TENANT_ID, hindrance_id: hindrance.id, photo_url: objectPath, retention_class: 'hindrance' })
  if (photoError) throw new Error(`seedHindranceWithPhoto photo insert failed: ${photoError.message}`)

  return { hindranceId: hindrance.id, photoPath: objectPath }
}

async function cleanupHindrance(hindranceId: string): Promise<void> {
  const db = testClient()
  await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceId)
  await db.from('hindrances').delete().eq('id', hindranceId)
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

// CHILD-FIRST, EVERY DELETE CHECKED (2026-09-17, CI run 35132707054's own
// diagnosis: this function used to delete dprs -> daily_logs ->
// project_members -> projects with no {error} check at all. daily_logs has
// no preceding daily_log_photos delete, so once Stage 4's own photo-seeding
// tests started calling this, the daily_logs delete silently failed on
// daily_log_photos_daily_log_id_fkey, then the projects delete silently
// failed too (blocked by the now-undeletable daily_logs row) -- both
// orphaned, forever, for that CI run, going undetected until a LATER test
// file's own ensureMorningFixtures() invariant tripped on the accumulated
// leftover project count. Full diagnosis: PR #283's own thread. Order here
// matches the actual FK graph: hindrance_photos -> hindrances,
// daily_log_photos -> daily_logs, then hindrances/dprs/daily_logs (all
// project_id children) -> project_members -> projects.
async function cleanupProject(projectId: string): Promise<void> {
  const db = testClient()

  const { data: hindranceRows, error: hindranceSelectErr } = await db.from('hindrances').select('id').eq('project_id', projectId)
  if (hindranceSelectErr) throw new Error(`cleanupProject: hindrances select failed for project ${projectId}: ${hindranceSelectErr.message}`)
  const hindranceIds = (hindranceRows ?? []).map((r) => r.id as string)
  if (hindranceIds.length > 0) {
    const { error: hpErr } = await db.from('hindrance_photos').delete().in('hindrance_id', hindranceIds)
    if (hpErr) throw new Error(`cleanupProject: hindrance_photos delete failed for project ${projectId}: ${hpErr.message}`)
  }

  const { data: dailyLogRows, error: dailyLogSelectErr } = await db.from('daily_logs').select('id').eq('project_id', projectId)
  if (dailyLogSelectErr) throw new Error(`cleanupProject: daily_logs select failed for project ${projectId}: ${dailyLogSelectErr.message}`)
  const dailyLogIds = (dailyLogRows ?? []).map((r) => r.id as string)
  if (dailyLogIds.length > 0) {
    const { error: dlpErr } = await db.from('daily_log_photos').delete().in('daily_log_id', dailyLogIds)
    if (dlpErr) throw new Error(`cleanupProject: daily_log_photos delete failed for project ${projectId}: ${dlpErr.message}`)
  }

  const { error: hindrancesErr } = await db.from('hindrances').delete().eq('project_id', projectId)
  if (hindrancesErr) throw new Error(`cleanupProject: hindrances delete failed for project ${projectId}: ${hindrancesErr.message}`)

  const { error: dprsErr } = await db.from('dprs').delete().eq('project_id', projectId)
  if (dprsErr) throw new Error(`cleanupProject: dprs delete failed for project ${projectId}: ${dprsErr.message}`)

  const { error: dailyLogsErr } = await db.from('daily_logs').delete().eq('project_id', projectId)
  if (dailyLogsErr) throw new Error(`cleanupProject: daily_logs delete failed for project ${projectId}: ${dailyLogsErr.message}`)

  const { error: memberErr } = await db.from('project_members').delete().eq('project_id', projectId)
  if (memberErr) throw new Error(`cleanupProject: project_members delete failed for project ${projectId}: ${memberErr.message}`)

  const { error: projectErr } = await db.from('projects').delete().eq('id', projectId)
  if (projectErr) throw new Error(`cleanupProject: projects delete failed for project ${projectId}: ${projectErr.message}`)
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
  if (uploadedTestPhotoPaths.length > 0) {
    await testClient().storage.from(PHOTO_BUCKET).remove(uploadedTestPhotoPaths)
  }
  await removeMorningFixtures()
})

beforeEach(() => {
  captureMessageMock.mockClear()
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

  // --- Stage 4: photo attachments on the report email (S1-S7) ---------

  it('STAGE 4: report email attaches evening then hindrance photos, no links anywhere in text or html', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-attached')
    const logDate = '2026-09-20'
    let hindranceId: string | undefined
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'complete')
      const eveningPath = await seedEveningPhoto(dailyLogId)
      const { hindranceId: hId, photoPath: hindrancePath } = await seedHindranceWithPhoto(projectId, engineerId, logDate, 'complete')
      hindranceId = hId
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_photos1' })
      const result = await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      expect(result.reportSent).toBe(1)
      expect(email.calls).toHaveLength(1)
      const call = email.calls[0] as { attachments?: { filename: string }[]; text: string; html: string }
      expect(call.attachments).toHaveLength(2)
      expect(call.attachments![0]!.filename).toBe(eveningPath.split('/').pop())
      expect(call.attachments![1]!.filename).toBe(hindrancePath.split('/').pop())
      expect(call.text).not.toMatch(/https?:\/\//)
      expect(call.html).not.toMatch(/https?:\/\//)

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      if (hindranceId) await cleanupHindrance(hindranceId)
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4: overflow line appears only when overflowCount > 0, matching the exact approved-pending wording', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-overflow')
    const logDate = '2026-09-21'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'complete')
      for (let i = 0; i < 11; i++) {
        await seedEveningPhoto(dailyLogId)
      }
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_overflow1' })
      const result = await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      expect(result.reportSent).toBe(1)
      const call = email.calls[0] as { attachments?: unknown[]; text: string; html: string }
      expect(call.attachments).toHaveLength(10)
      expect(call.text).toContain('1 more photo(s) from today were not attached.')
      expect(call.html).toContain('1 more photo(s) from today were not attached.')

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4: no overflow (all photos fit) -- overflow line is absent', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-no-overflow')
    const logDate = '2026-09-22'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'complete')
      await seedEveningPhoto(dailyLogId)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_no_overflow1' })
      await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      const call = email.calls[0] as { text: string; html: string }
      expect(call.text).not.toContain('not attached')
      expect(call.html).not.toContain('not attached')

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4: the no-report notice email NEVER gets attachments, even when photos exist for that project-day', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: null, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'notice-with-photos')
    const logDate = '2026-09-23'
    let hindranceId: string | undefined
    try {
      await addToProject(projectId, engineerId)
      // Evening NOT submitted -> routes to 'notice', but photos may still
      // exist (e.g. a morning-only day that also had a hindrance report).
      await seedDailyLog(projectId, engineerId, logDate, false)
      const { hindranceId: hId } = await seedHindranceWithPhoto(projectId, engineerId, logDate, 'complete')
      hindranceId = hId
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', false)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_notice_photos1' })
      const result = await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      expect(result.noticeSent).toBe(true)
      expect(email.calls).toHaveLength(1)
      const call = email.calls[0] as { attachments?: unknown[] }
      expect(call.attachments).toBeUndefined()

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('no_report_sent')
    } finally {
      if (hindranceId) await cleanupHindrance(hindranceId)
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4: evening_photos_status="pending" -> throws a retryable error, no send attempted', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-pending')
    const logDate = '2026-09-24'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'pending')
      await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      await expect(
        handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn }),
      ).rejects.toThrow(/photos still uploading/)
      expect(email.calls).toHaveLength(0)
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4: forceSendWithoutPhotos on a pending evening batch -- sends WITHOUT waiting, attaching whatever already has a row (never withholds the email)', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-forced')
    const logDate = '2026-09-25'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      // Still pending overall, but one photo row already landed before the
      // batch finished -- "send without the MISSING photos" (S5), not
      // "send with none at all."
      const eveningPath = await seedEveningPhoto(dailyLogId)
      await setEveningPhotosStatus(dailyLogId, 'pending')
      await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_forced1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, forceSendWithoutPhotos: true },
      )

      expect(result.reportSent).toBe(1)
      expect(email.calls).toHaveLength(1)
      const call = email.calls[0] as { attachments?: { filename: string }[] }
      expect(call.attachments).toHaveLength(1)
      expect(call.attachments![0]!.filename).toBe(eveningPath.split('/').pop())
    } finally {
      await cleanupProject(projectId)
    }
  })

  // --- F1/F2, whole-pipeline coverage (Aravind, 2026-09-16) -------------

  it('STAGE 4 (F1): evening_photos_status="pending", not forced -> ZERO Storage download calls, job throws for retry', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-pending-zero-dl')
    const logDate = '2026-09-26'
    const spy = withDownloadSpy(db)
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      // A real photo row exists -- if the readiness-before-download gate
      // didn't hold, this would be downloaded.
      await seedEveningPhoto(dailyLogId)
      await setEveningPhotosStatus(dailyLogId, 'pending')
      await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_should_not_be_used' })
      await expect(
        handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn }),
      ).rejects.toThrow(/photos still uploading/)
      expect(email.calls).toHaveLength(0)
      expect(spy.getCalls()).toBe(0)
    } finally {
      spy.restore()
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4 (F1): pending + forced -> downloads happen, email sent', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-pending-forced-dl')
    const logDate = '2026-09-27'
    const spy = withDownloadSpy(db)
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await seedEveningPhoto(dailyLogId)
      await setEveningPhotosStatus(dailyLogId, 'pending')
      await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_forced_dl1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, forceSendWithoutPhotos: true },
      )

      expect(result.reportSent).toBe(1)
      expect(email.calls).toHaveLength(1)
      expect(spy.getCalls()).toBeGreaterThan(0)
    } finally {
      spy.restore()
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4 (F2): one broken photo among valid ones -> email sent, broken skipped, overflow counts it, Sentry called with the fingerprint', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-one-broken')
    const logDate = '2026-09-28'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'complete')
      const brokenPath = await seedEveningPhoto(dailyLogId)
      const validPath = await seedEveningPhoto(dailyLogId)
      await breakPhoto(brokenPath)
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_one_broken1' })
      const result = await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      expect(result.reportSent).toBe(1)
      expect(email.calls).toHaveLength(1)
      const call = email.calls[0] as { attachments?: { filename: string }[]; text: string; html: string }
      expect(call.attachments).toHaveLength(1)
      expect(call.attachments![0]!.filename).toBe(validPath.split('/').pop())
      expect(call.text).toContain('1 more photo(s) from today were not attached.')
      expect(call.html).toContain('1 more photo(s) from today were not attached.')

      expect(captureMessageMock).toHaveBeenCalledTimes(1)
      const [message, options] = captureMessageMock.mock.calls[0]
      expect(message).toBe('dpr-photo-attach: download failed')
      expect(options.fingerprint).toEqual(['dpr-photo-attach', 'download_failed'])
      expect(options.tags).toEqual({ feature: 'owner-deliver' })

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4 (F2): forced send where EVERY photo fails -> email still sent, no attachments, overflow shows the full count', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-all-broken-forced')
    const logDate = '2026-09-29'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      const brokenPathA = await seedEveningPhoto(dailyLogId)
      const brokenPathB = await seedEveningPhoto(dailyLogId)
      await breakPhoto(brokenPathA)
      await breakPhoto(brokenPathB)
      // Still pending overall -- forced, same shape as the existing
      // forceSendWithoutPhotos test above, but every candidate also fails
      // its download once selection proceeds.
      await setEveningPhotosStatus(dailyLogId, 'pending')
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_all_broken_forced1' })
      const result = await handleOwnerDeliverJob(
        { project_id: projectId, log_date: logDate },
        { supabaseClient: db, sendEmailFn: email.fn, forceSendWithoutPhotos: true },
      )

      expect(result.reportSent).toBe(1)
      expect(email.calls).toHaveLength(1)
      const call = email.calls[0] as { attachments?: { filename: string }[]; text: string; html: string }
      expect(call.attachments).toBeUndefined()
      expect(call.text).toContain('2 more photo(s) from today were not attached.')
      expect(call.html).toContain('2 more photo(s) from today were not attached.')
      expect(captureMessageMock).toHaveBeenCalledTimes(2)

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      await cleanupProject(projectId)
    }
  })

  it('STAGE 4 (F2): a failed photo does not consume the 10-photo cap -- the next valid photo is attached', async () => {
    const db = testClient()
    await configureOwner(ownerId, { whatsappNumber: OWNER_PHONE, verifiedEmail: true })
    const engineerId = testEngineerId()
    const projectId = await makeProject(ownerId, 'photos-broken-cap')
    const logDate = '2026-09-30'
    try {
      await addToProject(projectId, engineerId)
      await seedDailyLog(projectId, engineerId, logDate, true)
      const dailyLogId = await getDailyLogId(projectId, engineerId, logDate)
      await setEveningPhotosStatus(dailyLogId, 'complete')
      const brokenPath = await seedEveningPhoto(dailyLogId)
      await breakPhoto(brokenPath)
      const validPaths: string[] = []
      for (let i = 0; i < 10; i++) {
        validPaths.push(await seedEveningPhoto(dailyLogId))
      }
      const dprId = await seedDprRow(projectId, engineerId, logDate, 'pending', true)

      const email = mockSendEmail({ ok: true, status: 200, id: 'em_broken_cap1' })
      const result = await handleOwnerDeliverJob({ project_id: projectId, log_date: logDate }, { supabaseClient: db, sendEmailFn: email.fn })

      expect(result.reportSent).toBe(1)
      const call = email.calls[0] as { attachments?: { filename: string }[]; text: string }
      expect(call.attachments).toHaveLength(10)
      expect(call.attachments!.map((a) => a.filename)).toEqual(validPaths.map((p) => p.split('/').pop()))
      expect(call.text).toContain('1 more photo(s) from today were not attached.')
      expect(captureMessageMock).toHaveBeenCalledTimes(1)

      const row = await readDpr(dprId)
      expect(row.delivery_status).toBe('delivered')
    } finally {
      await cleanupProject(projectId)
    }
  }, 30000)
})
