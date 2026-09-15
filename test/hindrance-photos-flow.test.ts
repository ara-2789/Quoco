import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import {
  routeInboundMessage,
  PHOTO_SAVED_REASK_PREFIX,
  HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY,
  buildHindrancePhotoAck,
} from '@/lib/whatsapp/inbound-start'
import { HINDRANCE_QUESTIONS, HINDRANCE_RESOLVED_REPLY, HINDRANCE_UNSPECIFIED_REPLY } from '@/lib/whatsapp/flows/hindrance'
import { testClient, cleanupTestSessions, testPhone, TEST_TENANT_ID, TEST_PROJECT_ID, testEngineerId, ensureMorningFixtures, removeMorningFixtures } from './helpers/db'

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage2-hindrance-photos-plan.md). Covers:
//   - a photo arriving at Q1 or Q2 (before the hindrances row exists) is
//     NOT stored -- Aravind's 2026-09-14 "no buffering" decision -- the
//     engineer is told and the question re-asks (this file's own headline
//     requirement).
//   - a photo arriving at Q3 (after the row exists) IS stored, via the
//     hindrance_media_ingest job, following the same "never call the RPC
//     for a photo turn" mechanism already live for morning/evening.
//   - the full Q1->Q2->Q3->completion flow, including the was_unspecified
//     bug this migration's own SQL comment documents finding and fixing
//     (completion now happens on Q3's turn, a SEPARATE call from Q2's own
//     resolution -- re-classifying Q3's text as a timing answer would have
//     silently misreported every completion as exhausted).
//
// Real test-db throughout via the injected supabaseClient param -- no
// mocks, same construction as test/inbound-start.test.ts and
// test/media-ingest.test.ts.

const NOW = '2026-09-14T12:00:00+05:30'

function baseParams(phone: string, message: string, media?: { url: string; contentType: string }[]) {
  return {
    phoneNumber: phone,
    tenantId: TEST_TENANT_ID,
    userId: testEngineerId(),
    projectId: TEST_PROJECT_ID,
    message,
    now: NOW,
    ...(media !== undefined ? { media, isPhoto: true } : {}),
    supabaseClient: testClient(),
  }
}

async function readSessionStep(phone: string): Promise<{ current_flow: string | null; current_step: number } | null> {
  const db = testClient()
  const { data } = await db
    .from('whatsapp_sessions')
    .select('current_flow, current_step')
    .eq('phone_number', phone)
    .maybeSingle<{ current_flow: string | null; current_step: number }>()
  return data ?? null
}

async function findHindranceId(description: string): Promise<string | null> {
  const db = testClient()
  const { data } = await db
    .from('hindrances')
    .select('id, photos_status')
    .eq('project_id', TEST_PROJECT_ID)
    .eq('reported_by', testEngineerId())
    .eq('description', description)
    .maybeSingle<{ id: string; photos_status: string | null }>()
  return data?.id ?? null
}

async function getHindrance(description: string) {
  const db = testClient()
  const { data } = await db
    .from('hindrances')
    .select('id, photos_status')
    .eq('project_id', TEST_PROJECT_ID)
    .eq('reported_by', testEngineerId())
    .eq('description', description)
    .maybeSingle<{ id: string; photos_status: string | null }>()
  return data
}

async function hindrancePhotoRows(hindranceId: string) {
  const db = testClient()
  const { data, error } = await db.from('hindrance_photos').select('*').eq('hindrance_id', hindranceId)
  if (error) throw error
  return data ?? []
}

async function hindranceMediaIngestJobsFor(hindranceId: string) {
  const db = testClient()
  const { data, error } = await db.from('jobs').select('payload').eq('type', 'hindrance_media_ingest').contains('payload', { hindrance_id: hindranceId })
  if (error) throw error
  return data ?? []
}

async function cleanupHindrances(descriptions: string[]) {
  const db = testClient()
  for (const description of descriptions) {
    const hindranceId = await findHindranceId(description)
    if (hindranceId) {
      await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceId)
      await db.from('jobs').delete().eq('type', 'hindrance_media_ingest').contains('payload', { hindrance_id: hindranceId })
    }
    await db.from('hindrances').delete().eq('project_id', TEST_PROJECT_ID).eq('reported_by', testEngineerId()).eq('description', description)
  }
}

const TRACKED_DESCRIPTIONS = [
  'photo-at-q1 test description',
  'photo-at-q2 test description',
  'photo-at-q3 test description',
  'full flow resolved test description',
  'full flow unspecified test description',
]

beforeAll(async () => {
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
  vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  await ensureMorningFixtures()
  await cleanupTestSessions()
  await cleanupHindrances(TRACKED_DESCRIPTIONS)
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupHindrances(TRACKED_DESCRIPTIONS)
})

afterAll(async () => {
  await removeMorningFixtures()
  vi.unstubAllEnvs()
})

describe('a photo before the hindrances row exists (Q1/Q2) is NOT stored -- Aravind, 2026-09-14', () => {
  it('photo at Q1 (description not yet answered): not stored, approved copy, question re-asked, current_step unchanged', async () => {
    const phone = testPhone('870')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    expect((await readSessionStep(phone))?.current_step).toBe(1)

    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ1Photo', contentType: 'image/jpeg' }]),
    )

    expect(resolvedFlow).toBe('hindrance')
    expect(reply).toBe(HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY)
    expect((await readSessionStep(phone))?.current_step).toBe(1)
    expect(await findHindranceId('photo-at-q1 test description')).toBeNull()
  })

  it('photo at Q2 (timing not yet answered): not stored, approved copy, question re-asked, current_step unchanged, no hindrances row', async () => {
    const phone = testPhone('871')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q2 test description', undefined))
    expect((await readSessionStep(phone))?.current_step).toBe(2)

    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ2Photo', contentType: 'image/jpeg' }]),
    )

    expect(resolvedFlow).toBe('hindrance')
    expect(reply).toBe(HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY)
    expect((await readSessionStep(phone))?.current_step).toBe(2)
    expect(await findHindranceId('photo-at-q2 test description')).toBeNull()

    // The engineer's real Q2 answer, sent right after, still resolves
    // normally -- the rejected photo left nothing behind to interfere.
    await routeInboundMessage(baseParams(phone, '1', undefined))
    expect((await readSessionStep(phone))?.current_step).toBe(3)
    expect(await findHindranceId('photo-at-q2 test description')).not.toBeNull()
  })
})

// Live prod finding, 2026-09-15 (Aravind): with items 12/23 in force ("a
// photo never answers a question"), Q3's own original copy ("...Reply none
// to skip.") left an engineer sending photos with no acknowledgement at
// all (uncaptioned) or a "type your reply" prompt that read as discarding
// his photos (captioned) -- because the only text that closed the
// question was "none". Fixed: every photo gets a running count
// acknowledgement; the engineer closes the question himself with "done"
// or "none" (both complete identically once the question has been
// reached; the wording only tells the engineer which one to use). Photos
// are never discarded regardless of which word is typed -- this handler
// has no delete path for hindrance_photos or its ingest jobs at all, so
// "none after photos" already can't discard them, by construction.
describe('a photo at Q3 (after the row exists) IS stored, acknowledged with a running count', () => {
  it('first photo: acknowledged with singular count "1 photo saved...", enqueues hindrance_media_ingest, sets photos_status=pending', async () => {
    const phone = testPhone('872')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined)) // Q2, resolved -> step 3
    expect((await readSessionStep(phone))?.current_step).toBe(3)

    const hindranceId = await findHindranceId('photo-at-q3 test description')
    expect(hindranceId).not.toBeNull()

    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3Photo', contentType: 'image/jpeg' }]),
    )

    expect(resolvedFlow).toBe('hindrance')
    expect(reply).toBe(buildHindrancePhotoAck(1))
    expect(reply).toBe('1 photo saved. Send more, or reply done.') // exact approved copy, singular
    expect(reply).not.toContain(PHOTO_SAVED_REASK_PREFIX) // scoped exception -- never fires at Q3
    expect((await readSessionStep(phone))?.current_step).toBe(3) // stays open -- a photo never answers

    const hindrance = await getHindrance('photo-at-q3 test description')
    expect(hindrance?.photos_status).toBe('pending')

    const jobs = await hindranceMediaIngestJobsFor(hindranceId!)
    expect(jobs.length).toBe(1)
    const payload = jobs[0].payload as { caption: string | null; media: unknown[]; tenant_id: string; hindrance_id: string }
    expect(payload.caption).toBeNull()
    expect(payload.media).toHaveLength(1)
    expect(payload.hindrance_id).toBe(hindranceId)
    expect(payload.tenant_id).toBe(TEST_TENANT_ID)
  })

  it('second photo: count increments to plural "2 photos saved..." -- cumulative for this hindrance', async () => {
    const phone = testPhone('876')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined))

    const { reply: first } = await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3First', contentType: 'image/jpeg' }]),
    )
    expect(first).toBe(buildHindrancePhotoAck(1))

    const { reply: second } = await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3Second', contentType: 'image/jpeg' }]),
    )
    expect(second).toBe(buildHindrancePhotoAck(2))
    expect(second).toBe('2 photos saved. Send more, or reply done.') // exact approved copy, plural

    const hindranceId = await findHindranceId('photo-at-q3 test description')
    const jobs = await hindranceMediaIngestJobsFor(hindranceId!)
    expect(jobs.length).toBe(2)
  })

  it('captioned photo: acknowledged the same as uncaptioned (no PHOTO_SAVED_REASK_PREFIX at Q3), caption stored on the job payload only, never treated as an answer (items 12/23)', async () => {
    const phone = testPhone('873')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined))

    const hindranceId = await findHindranceId('photo-at-q3 test description')

    const { reply } = await routeInboundMessage(
      baseParams(phone, 'crack near column B', [{ url: 'https://api.twilio.com/media/ZZQ3Captioned', contentType: 'image/jpeg' }]),
    )

    expect(reply).toBe(buildHindrancePhotoAck(1))
    expect(reply).not.toContain(PHOTO_SAVED_REASK_PREFIX)
    expect((await readSessionStep(phone))?.current_step).toBe(3)

    const jobs = await hindranceMediaIngestJobsFor(hindranceId!)
    expect(jobs.length).toBe(1)
    const payload = jobs[0].payload as { caption: string | null }
    expect(payload.caption).toBe('crack near column B')

    // "none" still completes the flow after a captioned photo -- the
    // caption never counted as an answer.
    const { reply: completionReply } = await routeInboundMessage(baseParams(phone, 'none', undefined))
    expect(completionReply).toBe(HINDRANCE_RESOLVED_REPLY)
    expect((await readSessionStep(phone))?.current_flow).toBeNull()
  })

  it('"done" completes the flow after photos have been sent', async () => {
    const phone = testPhone('877')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined))

    await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3Done', contentType: 'image/jpeg' }]),
    )

    const { reply } = await routeInboundMessage(baseParams(phone, 'done', undefined))
    expect(reply).toBe(HINDRANCE_RESOLVED_REPLY)
    expect((await readSessionStep(phone))?.current_flow).toBeNull()
  })

  it('"none" with ZERO photos sent skips normally -- unchanged behavior', async () => {
    const phone = testPhone('878')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined))

    const hindranceId = await findHindranceId('photo-at-q3 test description')
    expect((await hindranceMediaIngestJobsFor(hindranceId!)).length).toBe(0)

    const { reply } = await routeInboundMessage(baseParams(phone, 'none', undefined))
    expect(reply).toBe(HINDRANCE_RESOLVED_REPLY)
    expect((await readSessionStep(phone))?.current_flow).toBeNull()
  })

  it('"none" AFTER photos already exist behaves exactly like "done" -- flow completes and photos are KEPT, never discarded', async () => {
    const phone = testPhone('879')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'photo-at-q3 test description', undefined))
    await routeInboundMessage(baseParams(phone, '1', undefined))

    const hindranceId = await findHindranceId('photo-at-q3 test description')

    await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3KeepA', contentType: 'image/jpeg' }]),
    )
    await routeInboundMessage(
      baseParams(phone, '', [{ url: 'https://api.twilio.com/media/ZZQ3KeepB', contentType: 'image/jpeg' }]),
    )
    expect((await hindranceMediaIngestJobsFor(hindranceId!)).length).toBe(2)

    const { reply } = await routeInboundMessage(baseParams(phone, 'none', undefined))
    expect(reply).toBe(HINDRANCE_RESOLVED_REPLY)
    expect((await readSessionStep(phone))?.current_flow).toBeNull()

    // The two photo jobs enqueued before "none" are STILL there -- "none"
    // never triggers a discard, by construction (this handler has no
    // delete path for hindrance_photos or its ingest jobs at all).
    const jobsAfter = await hindranceMediaIngestJobsFor(hindranceId!)
    expect(jobsAfter.length).toBe(2)
    const hindrance = await getHindrance('photo-at-q3 test description')
    expect(hindrance?.photos_status).toBe('pending')
  })
})

describe('full flow, Q1 -> Q2 -> Q3 -> completion', () => {
  it('resolved timing: completion reply is the plain confirmation, was_unspecified correctly false across the Q2->Q3 gap', async () => {
    const phone = testPhone('874')
    const { reply: r1 } = await routeInboundMessage(baseParams(phone, '1', undefined))
    expect(r1).toBe(HINDRANCE_QUESTIONS[1])

    const { reply: r2 } = await routeInboundMessage(baseParams(phone, 'full flow resolved test description', undefined))
    expect(r2).toBe(HINDRANCE_QUESTIONS[2])

    const { reply: r3 } = await routeInboundMessage(baseParams(phone, '1', undefined))
    expect(r3).toBe(HINDRANCE_QUESTIONS[3])
    expect((await readSessionStep(phone))?.current_step).toBe(3)

    const hindrance = await getHindrance('full flow resolved test description')
    expect(hindrance).not.toBeNull()

    const { reply: r4 } = await routeInboundMessage(baseParams(phone, 'none', undefined))
    // REGRESSION GUARD for the bug this migration's own SQL comment
    // documents: wasExhausted used to be re-derived by re-classifying THIS
    // turn's message ("none") via classifyHindranceTiming, which would
    // have returned {ok:false}, silently reporting every completion as
    // exhausted. Fixed by reading was_unspecified from the RPC, carried
    // across the Q2->Q3 gap in session context.
    expect(r4).toBe(HINDRANCE_RESOLVED_REPLY)
    expect(r4).not.toBe(HINDRANCE_UNSPECIFIED_REPLY)
    expect((await readSessionStep(phone))?.current_flow).toBeNull()
  })

  it('unspecified timing (Q2 reask budget exhausted): completion reply is the distinct exhausted confirmation', async () => {
    const phone = testPhone('875')
    await routeInboundMessage(baseParams(phone, '1', undefined))
    await routeInboundMessage(baseParams(phone, 'full flow unspecified test description', undefined))

    // Two unparseable Q2 answers: first reasks (budget consumed), second
    // exhausts and resolves 'unspecified', advancing to step 3.
    const { reply: reaskReply } = await routeInboundMessage(baseParams(phone, 'not sure', undefined))
    expect(reaskReply).toBe(HINDRANCE_QUESTIONS[2])
    expect((await readSessionStep(phone))?.current_step).toBe(2)

    const { reply: q3Reply } = await routeInboundMessage(baseParams(phone, 'depends on the weather', undefined))
    expect(q3Reply).toBe(HINDRANCE_QUESTIONS[3])
    expect((await readSessionStep(phone))?.current_step).toBe(3)

    const hindrance = await getHindrance('full flow unspecified test description')
    expect(hindrance).not.toBeNull()

    const { reply: completionReply } = await routeInboundMessage(baseParams(phone, 'none', undefined))
    expect(completionReply).toBe(HINDRANCE_UNSPECIFIED_REPLY)
  })
})
