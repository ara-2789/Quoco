import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { handleWebhookPost } from '@/app/api/whatsapp/webhook/route'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  seedSession,
  seedDailyLogSubmission,
  readSession,
  getDailyLog,
  testPhone,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  TEST_ENGINEER_PHONE,
} from './helpers/db'
import { MORNING_QUESTIONS } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS, EVENING_ALREADY_COMPLETE_REPLY } from '@/lib/whatsapp/flows/evening'
import { REPORT_READY_REPLY, MORNING_WINDOW_CLOSED_REPLY, MORNING_AWAITING_TRIGGER_REPLY } from '@/lib/whatsapp/inbound-start'

// T-WH: the HTTP-level webhook harness named in CLAUDE.md's TESTING DEBT entry
// and migration 022's review package §10. Exercises handleWebhookPost
// (app/api/whatsapp/webhook/route.ts) directly with an injected test-db
// client — the SAME function POST calls in production, just with a
// substituted dependency (see that file's own header comment on why this is
// not a second, divergent assembly).
//
// SCOPE: signature validation, the BOT-08/BOT-27 gate, idempotency (including
// the RETRY-AFTER-CLEAR edge CLAUDE.md names explicitly), and proving the
// real HTTP path reaches routeInboundMessage and routes correctly. Retry-logic
// edge cases (wrong_flow, double wrong_flow) are DELIBERATELY NOT re-tested
// here — they are covered by test/dispatch.test.ts against dispatchInboundTurn
// directly; duplicating them here would test the same code twice at two
// layers for no additional confidence.
//
// II3 BUILD (inbound-as-start-trigger, docs/inbound-start-trigger-plan.md):
// T-WH-11/T-WH-12 below prove routeInboundMessage's no-active-session start
// decision is really wired into this webhook. The FULL window matrix
// (deterministic, `now`-injected) lives in test/inbound-start.test.ts
// instead — this file has no `now` injection point on the real webhook path
// (see todayIST() below), so a webhook-level test can only assert "one of
// the outcomes valid for whichever window the suite happens to run in," not
// pin an exact one. T-WH-03 (unregistered number) already proves the
// unknown-sender path is untouched by this build — nothing in routeInbound-
// Message runs before registration/gate resolution, so no new test was
// needed for that; T-WH-03 IS the proof, unmodified.
//
// T-WH-01's EXACT CLAIM: TWILIO_AUTH_TOKEN in .env.test is a fixed, obviously
// fake value (see that file). This proves validateTwilioSignature's HMAC-SHA1
// comparison correctly REJECTS a non-matching signature — i.e. the ALGORITHM
// is wired correctly. It does NOT prove production's real Vercel-configured
// TWILIO_AUTH_TOKEN is itself correct — that is a separate, unverified claim
// this suite cannot make.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
const REAL_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
if (!APP_URL || !REAL_AUTH_TOKEN) {
  throw new Error(
    'webhook.test.ts requires NEXT_PUBLIC_APP_URL and TWILIO_AUTH_TOKEN in .env.test',
  )
}
const WEBHOOK_URL = `${APP_URL}/api/whatsapp/webhook`

// Independent re-implementation of Twilio's documented signing algorithm —
// deliberately NOT imported from route.ts (validateTwilioSignature isn't
// exported, and importing it would only prove "calling the same function
// gives the same result," not that the implementation matches spec).
function signTwilioParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

function buildWebhookRequest(
  params: Record<string, string>,
  opts: { authToken?: string; signature?: string } = {},
): NextRequest {
  const signature =
    opts.signature ?? signTwilioParams(WEBHOOK_URL, params, opts.authToken ?? REAL_AUTH_TOKEN!)
  return new NextRequest(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature,
    },
    body: new URLSearchParams(params).toString(),
  })
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function twimlText(response: Response): Promise<string | null> {
  const xml = await response.text()
  const match = xml.match(/<Message>([\s\S]*?)<\/Message>/)
  return match ? unescapeXml(match[1]) : null
}

// today's IST calendar date — no `now` is injectable through the real webhook
// path (production never overrides it either, so this harness genuinely can't
// either), so daily_logs assertions must key off real current time.
function todayIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

async function wasProcessed(messageSid: string): Promise<boolean> {
  const db = testClient()
  const { data, error } = await db
    .from('processed_messages')
    .select('message_sid')
    .eq('message_sid', messageSid)
    .maybeSingle()
  if (error) throw new Error(`wasProcessed query failed: ${error.message}`)
  return data !== null
}

// Unique per suite RUN so re-runs never collide with a prior run's leftover
// processed_messages rows (no existing cleanup helper covers that table —
// this file cleans up its own in afterAll instead of adding shared plumbing
// for a single caller).
const RUN_TAG = crypto.randomUUID()
function sid(scenario: string): string {
  return `ZZTestWebhook-${RUN_TAG}-${scenario}`
}

// ---------------------------------------------------------------------------
// Dedicated gate-scenario users. Distinct from the shared morning-flow
// fixture engineer (TEST_ENGINEER_PHONE) so gating variations never risk
// perturbing state other test files in this suite depend on.
// ---------------------------------------------------------------------------

const PHONE_UNREGISTERED = testPhone('690') // never inserted
const PHONE_PENDING = testPhone('691')
const PHONE_DEACTIVATED = testPhone('692')
const PHONE_REACTIVATE = testPhone('693')
const PHONE_NO_PROJECT = testPhone('694')

interface GateUserSpec {
  phone: string
  status: 'pending' | 'active' | 'deactivated'
  messagingBlocked: boolean
  withProject: boolean
}

async function ensureGateUser(spec: GateUserSpec): Promise<string> {
  const db = testClient()
  const { data: ins, error } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_ID,
      full_name: `ZZ Test Gate User (${spec.phone})`,
      role: 'engineer',
      status: spec.status,
      messaging_blocked: spec.messagingBlocked,
      whatsapp_number: spec.phone,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !ins) {
    throw new Error(`ensureGateUser insert failed for ${spec.phone}: ${error?.message ?? 'no row'}`)
  }

  if (spec.withProject) {
    const { error: memberErr } = await db.from('project_members').insert({
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      user_id: ins.id,
      role: 'engineer',
    })
    if (memberErr) {
      throw new Error(`ensureGateUser project_members insert failed for ${spec.phone}: ${memberErr.message}`)
    }
  }
  return ins.id
}

// FK-safe order (project_members before users), mirroring removeMorningFixtures.
async function removeGateUsers(phones: string[]): Promise<void> {
  const db = testClient()
  const { data: rows, error: selErr } = await db
    .from('users')
    .select('id')
    .in('whatsapp_number', phones)
  if (selErr) throw new Error(`removeGateUsers select failed: ${selErr.message}`)
  const ids = (rows ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) return

  const { error: memberErr } = await db.from('project_members').delete().in('user_id', ids)
  if (memberErr) throw new Error(`removeGateUsers project_members cleanup failed: ${memberErr.message}`)

  const { error: userErr } = await db.from('users').delete().in('id', ids)
  if (userErr) throw new Error(`removeGateUsers users cleanup failed: ${userErr.message}`)
}

beforeAll(async () => {
  await ensureMorningFixtures()
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
  await ensureGateUser({ phone: PHONE_PENDING, status: 'pending', messagingBlocked: false, withProject: false })
  await ensureGateUser({ phone: PHONE_DEACTIVATED, status: 'deactivated', messagingBlocked: false, withProject: false })
  await ensureGateUser({ phone: PHONE_REACTIVATE, status: 'active', messagingBlocked: true, withProject: true })
  await ensureGateUser({ phone: PHONE_NO_PROJECT, status: 'active', messagingBlocked: false, withProject: false })
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterAll(async () => {
  await removeGateUsers([PHONE_PENDING, PHONE_DEACTIVATED, PHONE_REACTIVATE, PHONE_NO_PROJECT])
  await testClient().from('processed_messages').delete().like('message_sid', `ZZTestWebhook-${RUN_TAG}-%`)
  await removeMorningFixtures()
})

describe('handleWebhookPost — signature validation', () => {
  it('T-WH-01: a non-matching signature is rejected with 403 (algorithm proof only — see file header)', async () => {
    const params = { From: `whatsapp:${TEST_ENGINEER_PHONE}`, Body: 'hi', MessageSid: sid('forged-sig') }
    const forgedSignature = signTwilioParams(WEBHOOK_URL, params, 'a-completely-different-wrong-token')
    const req = buildWebhookRequest(params, { signature: forgedSignature })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(403)
    expect(await wasProcessed(params.MessageSid)).toBe(false)
  })

  it('T-WH-02: a missing X-Twilio-Signature header is rejected with 403', async () => {
    const params = { From: `whatsapp:${TEST_ENGINEER_PHONE}`, Body: 'hi', MessageSid: sid('missing-sig') }
    const req = new NextRequest(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(403)
  })
})

describe('handleWebhookPost — BOT-08 / BOT-27 gate', () => {
  it('T-WH-03: unregistered number gets the BOT-08 response, zero storage footprint', async () => {
    const messageSid = sid('unregistered')
    const req = buildWebhookRequest({ From: `whatsapp:${PHONE_UNREGISTERED}`, Body: 'hi', MessageSid: messageSid })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await twimlText(res)).toBe(
      'This number is not registered with Quoco. Contact your Project Manager.',
    )
    expect(await readSession(PHONE_UNREGISTERED)).toBeNull()
    expect(await wasProcessed(messageSid)).toBe(false)
  })

  it('T-WH-04: gated_noop (pending status) is a silent no-op, zero storage footprint', async () => {
    const messageSid = sid('pending')
    const req = buildWebhookRequest({ From: `whatsapp:${PHONE_PENDING}`, Body: 'hi', MessageSid: messageSid })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<Response></Response>')
    expect(await readSession(PHONE_PENDING)).toBeNull()
    expect(await wasProcessed(messageSid)).toBe(false)
  })

  it('T-WH-05: gated_noop (deactivated status) is a silent no-op, zero storage footprint', async () => {
    const messageSid = sid('deactivated')
    const req = buildWebhookRequest({ From: `whatsapp:${PHONE_DEACTIVATED}`, Body: 'hi', MessageSid: messageSid })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<Response></Response>')
    expect(await readSession(PHONE_DEACTIVATED)).toBeNull()
    expect(await wasProcessed(messageSid)).toBe(false)
  })

  it('T-WH-06: registered + active + unblocked but no project membership gets an actionable message (SID still consumed)', async () => {
    const messageSid = sid('no-project')
    const req = buildWebhookRequest({ From: `whatsapp:${PHONE_NO_PROJECT}`, Body: 'hi', MessageSid: messageSid })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await twimlText(res)).toBe(
      'Your number is registered but not yet linked to a project. Contact your Project Manager to be added.',
    )
    // Idempotency runs BEFORE project resolution in route.ts, so this differs
    // from T-WH-03/04/05: the SID IS recorded even though no flow ran.
    expect(await wasProcessed(messageSid)).toBe(true)
  })

  it('T-WH-07: reactivate clears the block, then a Twilio RETRY of the SAME MessageSid is a no-op — NOT a morning-flow turn', async () => {
    const reactSid = sid('reactivate')
    const params = { From: `whatsapp:${PHONE_REACTIVATE}`, Body: 'hi', MessageSid: reactSid }

    // --- First delivery: active + blocked -> 'reactivate' -------------------
    const req1 = buildWebhookRequest(params)
    const res1 = await handleWebhookPost(req1, { supabaseClient: testClient() })
    expect(res1.status).toBe(200)
    expect(await twimlText(res1)).toBe("You're reconnected to Quoco.")
    expect(await wasProcessed(reactSid)).toBe(true)

    const db = testClient()
    const { data: userAfterClear, error: readErr } = await db
      .from('users')
      .select('id, messaging_blocked')
      .eq('whatsapp_number', PHONE_REACTIVATE)
      .single<{ id: string; messaging_blocked: boolean }>()
    if (readErr) throw new Error(`read-back failed: ${readErr.message}`)
    expect(userAfterClear.messaging_blocked).toBe(false)

    // --- Twilio RETRY: SAME MessageSid, engineer is NOW active+unblocked ---
    // decideInboundGate now returns 'proceed', not 'reactivate' — this is
    // exactly the scenario the "consume the SID before the clear" ordering in
    // route.ts exists to guard: the retry must be caught by the ORDINARY
    // path's own idempotency check (same SID, already recorded), not fall
    // through into a real morning-flow turn.
    const req2 = buildWebhookRequest(params)
    const res2 = await handleWebhookPost(req2, { supabaseClient: testClient() })
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ status: 'duplicate_ignored' })

    expect(await readSession(PHONE_REACTIVATE)).toBeNull()
    const { data: strayLog, error: logErr } = await db
      .from('daily_logs')
      .select('id')
      .eq('engineer_id', userAfterClear.id)
      .eq('log_date', todayIST())
      .maybeSingle()
    if (logErr) throw new Error(`stray daily_logs check failed: ${logErr.message}`)
    expect(strayLog).toBeNull()
  })
})

describe('handleWebhookPost — ordinary-path idempotency', () => {
  it('T-WH-08: a duplicate MessageSid on an ordinary reply is a no-op, no double-write', async () => {
    await seedSession({
      phone: TEST_ENGINEER_PHONE,
      currentFlow: 'morning',
      currentStep: 2, // Q2 plan (030_morning_flow_attendance.sql renumbering — step 1 is now attendance)
      context: {},
      updatedAt: new Date().toISOString(),
    })
    const params = {
      From: `whatsapp:${TEST_ENGINEER_PHONE}`,
      Body: 'Pour slab on level 3',
      MessageSid: sid('idem-dup'),
    }

    const res1 = await handleWebhookPost(buildWebhookRequest(params), { supabaseClient: testClient() })
    expect(res1.status).toBe(200)
    expect(await twimlText(res1)).toBe(MORNING_QUESTIONS[3])
    expect((await getDailyLog(todayIST()))?.morning_plan).toBe('Pour slab on level 3')
    expect((await readSession(TEST_ENGINEER_PHONE))?.current_step).toBe(3)

    // Genuine Twilio retry: identical SID and body, second delivery.
    const res2 = await handleWebhookPost(buildWebhookRequest(params), { supabaseClient: testClient() })
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ status: 'duplicate_ignored' })
    // Unchanged by the duplicate — not re-applied, not advanced a second time.
    expect((await getDailyLog(todayIST()))?.morning_plan).toBe('Pour slab on level 3')
    expect((await readSession(TEST_ENGINEER_PHONE))?.current_step).toBe(3)
  })
})

describe('handleWebhookPost — routes to whichever flow is active (dispatchInboundTurn wiring)', () => {
  it('T-WH-09: an ordinary reply on an active morning session reaches morning', async () => {
    await seedSession({
      phone: TEST_ENGINEER_PHONE,
      currentFlow: 'morning',
      currentStep: 2, // Q2 plan (030_morning_flow_attendance.sql renumbering — step 1 is now attendance)
      context: {},
      updatedAt: new Date().toISOString(),
    })
    const req = buildWebhookRequest({
      From: `whatsapp:${TEST_ENGINEER_PHONE}`,
      Body: 'Pour slab on level 3',
      MessageSid: sid('route-morning'),
    })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await twimlText(res)).toBe(MORNING_QUESTIONS[3])
    expect((await getDailyLog(todayIST()))?.morning_plan).toBe('Pour slab on level 3')
  })

  it('T-WH-10: an ordinary reply on an active evening session reaches evening', async () => {
    await seedSession({
      phone: TEST_ENGINEER_PHONE,
      currentFlow: 'evening',
      currentStep: 1,
      context: {},
      updatedAt: new Date().toISOString(),
    })
    const req = buildWebhookRequest({
      From: `whatsapp:${TEST_ENGINEER_PHONE}`,
      Body: 'some work done',
      MessageSid: sid('route-evening'),
    })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    expect(await twimlText(res)).toBe(EVENING_QUESTIONS[2])
    expect((await getDailyLog(todayIST()))?.evening_output).toBe('some work done')
  })
})

describe('handleWebhookPost — no active session (routeInboundMessage wiring)', () => {
  it('T-WH-11: registered engineer, no session, nothing submitted today — never silent', async () => {
    // See the file header: no `now` injection point exists here, so the
    // exact outcome depends on which IST window the suite runs in. All
    // valid outcomes are asserted explicitly; what they all share, and what
    // this test actually proves, is that the reply is never '' any more —
    // the BOT-07 silence CLAUDE.md's "BOT-07 SILENCE IS A RULE 3.5
    // DEAD-END" entry names is closed for this case by this build.
    // RETIRED, 2026-08-28: idle inbound no longer starts a flow
    // (MORNING_QUESTIONS[1] is no longer a possible outcome of this path
    // at all) -- MORNING_AWAITING_TRIGGER_REPLY replaces it for the
    // before-morningCutoff window. THREE outcomes still, per §35a
    // (design-decisions-beta-feedback.md, 2026-08-26): MORNING_WINDOW_
    // CLOSED_REPLY covers the whole morningCutoff..eveningClose window
    // (15:00-19:45 IST), a real interval this suite can genuinely run
    // inside.
    const req = buildWebhookRequest({
      From: `whatsapp:${TEST_ENGINEER_PHONE}`,
      Body: 'hi',
      MessageSid: sid('start-no-session'),
    })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    const reply = await twimlText(res)
    expect(reply).not.toBeNull()
    expect(
      reply === MORNING_AWAITING_TRIGGER_REPLY ||
        reply === MORNING_WINDOW_CLOSED_REPLY ||
        reply === REPORT_READY_REPLY,
    ).toBe(true)
    // No RPC is ever called from this path any more -- confirm no session
    // row materialised, regardless of which of the three windows this run
    // landed in.
    expect(await readSession(TEST_ENGINEER_PHONE)).toBeNull()
  })

  it('T-WH-12: registered engineer, no session, both already submitted today — an already-done reply, no restart', async () => {
    await seedDailyLogSubmission({
      logDate: todayIST(),
      morningSubmittedAt: new Date().toISOString(),
      eveningSubmittedAt: new Date().toISOString(),
    })
    const req = buildWebhookRequest({
      From: `whatsapp:${TEST_ENGINEER_PHONE}`,
      Body: 'hi',
      MessageSid: sid('start-both-done'),
    })
    const res = await handleWebhookPost(req, { supabaseClient: testClient() })
    expect(res.status).toBe(200)
    const reply = await twimlText(res)
    // Same before/after-eveningClose variance as T-WH-11, same reason.
    expect(reply === EVENING_ALREADY_COMPLETE_REPLY || reply === REPORT_READY_REPLY).toBe(true)
    // Neither outcome calls an RPC -- confirm no session row materialised.
    expect(await readSession(TEST_ENGINEER_PHONE)).toBeNull()
  })
})
