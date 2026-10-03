import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  routeInboundMessage,
  buildIdleReply,
  buildIdleMenu,
  computeIdleHeaderState,
} from '@/lib/whatsapp/inbound-start'
import { istParts } from '@/lib/daily-logs/status'
import { MEDIA_NUDGE_REPLY, MEDIA_NUDGE_PROGRESS_LINE, type MediaItem } from '@/lib/whatsapp/media-reply'
import { HINDRANCE_QUESTIONS } from '@/lib/whatsapp/flows/hindrance'

// Pure unit tests for the "stale previous-day flow" fix (branch
// fix/stale-flow-next-day). NO real database connection anywhere in this
// file -- every Supabase call routeInboundMessage can make is served by a
// hand-built stub client below, same shape as test/inbound-start.test.ts's
// own `buildFailingHeaderLookupClient` (that file's one non-real-test-db
// describe block) and test/unit/checkin-escalations-sweep.test.ts's
// `buildStubClient`. Deliberately NOT added to test/inbound-start.test.ts
// itself (that file's other describe blocks ARE real-test-db-backed) and
// deliberately imports nothing from this project's shared DB test fixtures.

const PHONE = '+911234500001'
const TENANT_ID = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-00000000a002'
const PROJECT_ID = '00000000-0000-0000-0000-00000000a003'

// Previous-day session, read the morning after.
const PREV_DAY_SESSION_UPDATED_AT = '2026-09-29T20:00:00+05:30'
const NEXT_DAY_NOW = '2026-09-30T10:00:00+05:30'

// Same-day boundary (T5) -- must stay routed as active both before and
// after this fix.
const SAME_DAY_SESSION_UPDATED_AT = '2026-09-30T23:58:00+05:30'
const SAME_DAY_NOW = '2026-09-30T23:59:00+05:30'

// Midnight-IST boundary (T6) -- only 60 real seconds apart, but a
// different Asia/Kolkata calendar date; proves the check is a calendar-date
// comparison (quoco_same_ist_day's own semantics), not a duration/threshold.
const PREV_DAY_BOUNDARY_UPDATED_AT = '2026-09-29T23:59:30+05:30'
const NEXT_DAY_BOUNDARY_NOW = '2026-09-30T00:00:30+05:30'

interface DailyLogRow {
  morning_submitted_at: string | null
  evening_submitted_at: string | null
  attendance: 'present' | 'absent' | 'site_holiday' | null
}

interface StubOpts {
  sessionRow: { current_flow: string | null; updated_at: string } | null
  dailyLogRow?: DailyLogRow | null
  /** Keyed by RPC name. A name not listed here throws if called -- the
   * mechanism that turns a pre-fix "active flow" misroute into a failing
   * test (an unconfigured RPC the old/buggy code path reaches), same as an
   * unconfigured table throwing below. */
  rpcResponses?: Record<string, { data: unknown; error: unknown }>
}

function buildStubClient(opts: StubOpts): {
  client: SupabaseClient
  rpcCalls: { name: string; args: unknown }[]
} {
  const rpcCalls: { name: string; args: unknown }[] = []

  const sessionBuilder = {
    select() {
      return sessionBuilder
    },
    eq() {
      return sessionBuilder
    },
    maybeSingle() {
      return Promise.resolve({ data: opts.sessionRow, error: null })
    },
  }

  const dailyLogsBuilder = {
    select() {
      return dailyLogsBuilder
    },
    eq() {
      return dailyLogsBuilder
    },
    maybeSingle() {
      return Promise.resolve({ data: opts.dailyLogRow ?? null, error: null })
    },
    update() {
      throw new Error('stub: daily_logs.update should never be called in this test')
    },
    insert() {
      throw new Error('stub: daily_logs.insert should never be called in this test')
    },
  }

  const jobsBuilder = {
    insert() {
      throw new Error('stub: jobs.insert (enqueueJob, media_ingest) should never be called in this test')
    },
  }

  function from(table: string) {
    if (table === 'whatsapp_sessions') return sessionBuilder
    if (table === 'daily_logs') return dailyLogsBuilder
    if (table === 'jobs') return jobsBuilder
    throw new Error(`stub: unexpected table access in this test: ${table}`)
  }

  function rpc(name: string, args: unknown) {
    rpcCalls.push({ name, args })
    const canned = opts.rpcResponses?.[name]
    if (!canned) {
      throw new Error(`stub: unexpected rpc call in this test: ${name}`)
    }
    return Promise.resolve(canned)
  }

  return { client: { from, rpc } as unknown as SupabaseClient, rpcCalls }
}

function expectedIdleReply(nowIso: string): string {
  const ist = istParts(new Date(nowIso))
  const headerState = computeIdleHeaderState({
    morningSubmitted: false,
    eveningSubmitted: false,
    attendance: null,
    istMinutes: ist.minutes,
  })
  return buildIdleReply('unrecognized', headerState)
}

function expectedIdlePhotoReply(nowIso: string): string {
  const ist = istParts(new Date(nowIso))
  const headerState = computeIdleHeaderState({
    morningSubmitted: false,
    eveningSubmitted: false,
    attendance: null,
    istMinutes: ist.minutes,
  })
  return [MEDIA_NUDGE_REPLY, MEDIA_NUDGE_PROGRESS_LINE, buildIdleMenu(headerState)].join('\n')
}

describe('routeInboundMessage — stale previous-day session (fix/stale-flow-next-day)', () => {
  it('T1: previous-day session current_flow=evening, text "hello" -> idle menu reply, no RPC call', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'evening', updated_at: PREV_DAY_SESSION_UPDATED_AT },
      dailyLogRow: null,
    })

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: 'hello',
      now: NEXT_DAY_NOW,
      supabaseClient: client,
    })

    expect(result.reply).toBe(expectedIdleReply(NEXT_DAY_NOW))
    expect(result.resolvedFlow).toBeNull()
    expect(rpcCalls.length).toBe(0)
  })

  it('T2: previous-day session current_flow=evening, text "1" -> hindrance flow start reply', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'evening', updated_at: PREV_DAY_SESSION_UPDATED_AT },
      dailyLogRow: null,
      rpcResponses: {
        apply_hindrance_flow_turn: {
          data: {
            outcome: 'start',
            current_flow: 'hindrance',
            current_step: 1,
            hindrance_id: null,
            was_unspecified: false,
          },
          error: null,
        },
      },
    })

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: '1',
      now: NEXT_DAY_NOW,
      supabaseClient: client,
    })

    expect(result.reply).toBe(HINDRANCE_QUESTIONS[1])
    expect(result.resolvedFlow).toBe('hindrance')
    expect(rpcCalls.map((c) => c.name)).toEqual(['apply_hindrance_flow_turn'])
  })

  it('T3: previous-day session, photo with media, no text -> idle photo nudge, no media_ingest enqueue, no daily_logs write', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'evening', updated_at: PREV_DAY_SESSION_UPDATED_AT },
      dailyLogRow: null,
      rpcResponses: {
        claim_media_nudge: { data: true, error: null },
      },
    })

    const media: MediaItem[] = [{ url: 'https://example.invalid/photo.jpg', contentType: 'image/jpeg' }]

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: '',
      isPhoto: true,
      media,
      now: NEXT_DAY_NOW,
      supabaseClient: client,
    })

    expect(result.reply).toBe(expectedIdlePhotoReply(NEXT_DAY_NOW))
    expect(result.resolvedFlow).toBeNull()
    expect(rpcCalls.map((c) => c.name)).toEqual(['claim_media_nudge'])
  })

  it('T4: previous-day session current_flow=hindrance, text "hello" -> idle menu reply', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'hindrance', updated_at: PREV_DAY_SESSION_UPDATED_AT },
      dailyLogRow: null,
    })

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: 'hello',
      now: NEXT_DAY_NOW,
      supabaseClient: client,
    })

    expect(result.reply).toBe(expectedIdleReply(NEXT_DAY_NOW))
    expect(result.resolvedFlow).toBeNull()
    expect(rpcCalls.length).toBe(0)
  })

  it('T5: same-day session at 23:59 IST -> still routed active, dispatch path (boundary, must stay green before and after)', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'evening', updated_at: SAME_DAY_SESSION_UPDATED_AT },
      rpcResponses: {
        // Shape read directly from applyEveningFlowTurn's own result cast
        // (lib/whatsapp/flows/evening.ts:365-373) -- current_step:2 (not 4)
        // deliberately, to avoid the extra fetchMorningEquipmentEcho lookup
        // that only fires when current_step === 4 (evening.ts:376-382).
        apply_evening_flow_turn: {
          data: {
            outcome: 'reask',
            current_flow: 'evening',
            current_step: 2,
            log_date: '2026-09-30',
            equipment_echo: null,
            hindrance_discarded: null,
            hindrance_had_description: null,
          },
          error: null,
        },
      },
    })

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: 'some answer',
      now: SAME_DAY_NOW,
      supabaseClient: client,
    })

    // This case is a ROUTING regression guard, not a reply-content check
    // (see plan §4, T5): the assertion is that the dispatch path -- not the
    // idle path -- was reached, proving a same-day session's routing is
    // unchanged by this fix.
    expect(result.resolvedFlow).toBe('evening')
    expect(rpcCalls.map((c) => c.name)).toContain('apply_evening_flow_turn')
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('T6: previous-day session 30s before midnight IST, now 30s after -> idle (date boundary, not a duration check)', async () => {
    const { client, rpcCalls } = buildStubClient({
      sessionRow: { current_flow: 'evening', updated_at: PREV_DAY_BOUNDARY_UPDATED_AT },
      dailyLogRow: null,
    })

    const result = await routeInboundMessage({
      phoneNumber: PHONE,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      message: 'hello',
      now: NEXT_DAY_BOUNDARY_NOW,
      supabaseClient: client,
    })

    expect(result.reply).toBe(expectedIdleReply(NEXT_DAY_BOUNDARY_NOW))
    expect(result.resolvedFlow).toBeNull()
    expect(rpcCalls.length).toBe(0)
  })
})
