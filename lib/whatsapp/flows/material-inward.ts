import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import type { Json } from '@/types/database'
import { createServiceClient } from '@/lib/supabase/service'
import { expireStaleMaterialInward } from '../session'
import type { MediaItem } from '../media-reply'
import { MORNING_QUESTIONS } from './morning'
import { EVENING_QUESTIONS } from './evening'
import {
  MI_SESSION_ENDED_REPLY,
  MI_ASK_KIND,
  MI_ASK_FILE_DC,
  MI_ASK_FILE_INVOICE,
  MI_FILE_RECEIVED,
  MI_ACK_QUESTION_DC,
  MI_ACK_QUESTION_INVOICE,
  MI_ASK_NOTE_NO,
  MI_ASK_NOTE_PARTIAL,
  MI_ACK_REASK,
  MI_NOT_UNDERSTOOD_CLOSE,
  MI_DONE,
  MI_KIND_REASK,
  MI_FILE_REASK,
  MI_NOTHING_RECORDED_CLOSE,
  MI_UNSUPPORTED_FILE_REPLY,
  MI_CAPTURE_FAILED_REPLY,
  CHECKIN_RESET_EXPLAIN_REPLY,
} from './material-inward-strings'

// PR-C C4a (docs/plans/pr-c-plan.md section 3a, 7, 3f step 5): the engineer-side handler for the material-inward
// ('invoice') session. DARK: nothing reaches it until the digit-4 switch is live for a phone (capture-switch.ts), and
// no 'invoice' session can exist before then.
//
// ERROR TEXT RULE (plan item 4): nothing thrown or sent to Sentry from this file carries a phone, URL, message body,
// tenant id or user id. Thrown messages name the RPC and a sanitised error code only; Sentry gets static text plus
// {mediaCount, contentTypes, errorCode}. No existing throw site elsewhere is touched.

export type MaterialInwardOutcome =
  | 'start'
  | 'advance'
  | 'reask'
  | 'closed'
  | 'complete'
  | 'file_attached'
  | 'duplicate'
  | 'expired'
  | 'idle'
  | 'wrong_flow'

const OUTCOMES: readonly MaterialInwardOutcome[] = [
  'start',
  'advance',
  'reask',
  'closed',
  'complete',
  'file_attached',
  'duplicate',
  'expired',
  'idle',
  'wrong_flow',
]

export interface MaterialInwardTurnResult {
  outcome: MaterialInwardOutcome
  currentFlow: string | null
  currentStep: number
  documentId: string | null
}

export interface MaterialInwardReply {
  reply: string
  resolvedFlow: 'invoice' | null
}

/** A PostgreSQL / PostgREST error reduced to a sanitised code. Never carries the provider's message text. */
export class MaterialInwardDbError extends Error {
  readonly code: string
  constructor(what: string, rawCode: unknown) {
    const code = sanitiseErrorCode(rawCode)
    super(`${what} failed (code ${code})`)
    this.name = 'MaterialInwardDbError'
    this.code = code
  }
}

/** error.code only if it is exactly five upper-case letters/digits (a SQLSTATE such as QE012, 22P02); else 'unknown'. */
export function sanitiseErrorCode(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Z0-9]{5}$/.test(raw) ? raw : 'unknown'
}

function errorCodeOf(err: unknown): string {
  if (err instanceof MaterialInwardDbError) return err.code
  return 'unknown'
}

interface ApplyParams {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  messageSid: string
  /** Files accepted from this message (already filtered to usable items). Omitted/empty = a text turn. */
  media?: MediaItem[]
  startFlow: boolean
  now?: string
  supabaseClient?: SupabaseClient
}

/** Wraps apply_material_inward_turn (migration 050, service_role only). */
export async function applyMaterialInwardTurn(params: ApplyParams): Promise<MaterialInwardTurnResult> {
  const supabase = params.supabaseClient ?? createServiceClient()
  const media = params.media ?? []
  const { data, error } = await supabase.rpc('apply_material_inward_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_message_sid: params.messageSid,
    // `index` is omitted on purpose: the RPC then uses the ordinal (S050 COALESCE(index, ord - 1)).
    p_media:
      media.length > 0
        ? (media.map((m) => ({ content_type: m.contentType.trim().toLowerCase(), url: m.url })) as unknown as Json)
        : undefined,
    p_start_flow: params.startFlow,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
  })
  if (error) throw new MaterialInwardDbError('apply_material_inward_turn', error.code)

  const row = (data ?? {}) as { [key: string]: Json | undefined }
  const outcome = row.outcome
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as MaterialInwardOutcome)) {
    throw new Error('apply_material_inward_turn returned an unexpected outcome')
  }
  return {
    outcome: outcome as MaterialInwardOutcome,
    currentFlow: typeof row.current_flow === 'string' ? row.current_flow : null,
    currentStep: typeof row.current_step === 'number' ? row.current_step : 0,
    documentId: typeof row.document_id === 'string' ? row.document_id : null,
  }
}

/** Decision Q11: a file that arrives after the session ended is not stored; one counts-only event makes that visible. */
export function reportFileAfterSessionEnded(media: readonly MediaItem[]): void {
  if (media.length === 0) return
  Sentry.captureMessage('file received after the material-inward session ended', {
    level: 'info',
    fingerprint: ['capture-router', 'file_after_session_ended'],
    tags: { feature: 'capture-router' },
    extra: { mediaCount: media.length, contentTypes: media.map((m) => m.contentType) },
  })
}

// ---------------------------------------------------------------------------
// post-RPC reads (inside the S-F try/catch for file turns)
// ---------------------------------------------------------------------------

async function readKind(supabase: SupabaseClient, phoneNumber: string, tenantId: string): Promise<'dc' | 'invoice'> {
  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .select('context')
    .eq('phone_number', phoneNumber)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ context: Record<string, unknown> | null }>()
  if (error) throw new MaterialInwardDbError('material-inward session read', error.code)
  const kind = data?.context?.mi_kind
  if (kind !== 'dc' && kind !== 'invoice') throw new Error('material-inward session has no kind')
  return kind
}

async function readAck(supabase: SupabaseClient, documentId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('capture_documents')
    .select('engineer_ack')
    .eq('id', documentId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ engineer_ack: string | null }>()
  if (error) throw new MaterialInwardDbError('material-inward document read', error.code)
  if (!data) throw new Error('material-inward document not found')
  return data.engineer_ack
}

interface ReplyContext {
  supabase: SupabaseClient
  phoneNumber: string
  tenantId: string
  documentId: string | null
}

/** The question the engineer owes at `step`, as plain approved text. */
async function promptForStep(step: number, ctx: ReplyContext): Promise<string> {
  switch (step) {
    case 1:
      return MI_ASK_KIND
    case 2:
      return (await readKind(ctx.supabase, ctx.phoneNumber, ctx.tenantId)) === 'invoice'
        ? MI_ASK_FILE_INVOICE
        : MI_ASK_FILE_DC
    case 3:
      return (await readKind(ctx.supabase, ctx.phoneNumber, ctx.tenantId)) === 'invoice'
        ? MI_ACK_QUESTION_INVOICE
        : MI_ACK_QUESTION_DC
    case 4: {
      if (ctx.documentId === null) throw new Error('material-inward step 4 without a document')
      const ack = await readAck(ctx.supabase, ctx.documentId, ctx.tenantId)
      if (ack === 'no') return MI_ASK_NOTE_NO
      if (ack === 'partial') return MI_ASK_NOTE_PARTIAL
      throw new Error('material-inward step 4 without a no/partial ack')
    }
    default:
      throw new Error('material-inward prompt for an unknown step')
  }
}

export interface MaterialInwardTurnParams {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  messageSid: string
  /** The router classified this message as carrying a photo (even if no item could be extracted). */
  isPhoto: boolean
  /** Usable image items extracted from this message. */
  media: MediaItem[]
  /** ISO string; omitted = the database clock (production). */
  now?: string
  /** The 'invoice' row's expires_at as the router read it; needed to clear a day-stale row on the 'idle' outcome. */
  expiresAt: string | null
}

interface WrongFlowMarker {
  kind: 'wrong_flow_unmapped'
}

/**
 * One engineer turn inside a live 'invoice' session. File turns are wrapped in the S-F-1 catch (plan section 3a):
 * on any failure of the RPC or the post-RPC reads, a counts-only Sentry error, MI_CAPTURE_FAILED_REPLY, HTTP 200.
 * Text turns are NOT wrapped: a failure propagates (500), like the other flows (decision Q6b).
 */
export async function handleMaterialInwardTurn(
  params: MaterialInwardTurnParams,
  supabaseClient?: SupabaseClient,
): Promise<MaterialInwardReply> {
  const supabase = supabaseClient ?? createServiceClient()
  const filesPresent = params.isPhoto || params.media.length > 0

  // Files present but none usable (e.g. a photo whose MediaUrl was missing): nothing to record, no RPC.
  if (filesPresent && params.media.length === 0) {
    return { reply: MI_UNSUPPORTED_FILE_REPLY, resolvedFlow: 'invoice' }
  }

  const run = async (): Promise<MaterialInwardReply | WrongFlowMarker> => {
    const result = await applyMaterialInwardTurn({
      phoneNumber: params.phoneNumber,
      tenantId: params.tenantId,
      userId: params.userId,
      projectId: params.projectId,
      message: params.message,
      messageSid: params.messageSid,
      media: params.media,
      startFlow: false,
      ...(params.now !== undefined ? { now: params.now } : {}),
      supabaseClient: supabase,
    })
    const ctx: ReplyContext = {
      supabase,
      phoneNumber: params.phoneNumber,
      tenantId: params.tenantId,
      documentId: result.documentId,
    }
    const n = params.media.length
    const reply = (text: string): MaterialInwardReply => ({ reply: text, resolvedFlow: 'invoice' })

    switch (result.outcome) {
      case 'start':
        return reply(MI_ASK_KIND)
      case 'advance':
        if (result.currentStep === 3) {
          return reply([MI_FILE_RECEIVED(n), await promptForStep(3, ctx)].join('\n'))
        }
        return reply(await promptForStep(result.currentStep, ctx))
      case 'file_attached':
        return reply([MI_FILE_RECEIVED(n), await promptForStep(result.currentStep, ctx)].join('\n'))
      case 'reask':
        if (result.currentStep === 1) return reply([MI_KIND_REASK, MI_ASK_KIND].join('\n'))
        if (result.currentStep === 2) return reply(MI_FILE_REASK)
        if (result.currentStep === 3) return reply([MI_ACK_REASK, await promptForStep(3, ctx)].join('\n'))
        return reply(await promptForStep(result.currentStep, ctx))
      case 'closed':
        return reply(MI_NOTHING_RECORDED_CLOSE)
      case 'complete': {
        if (result.documentId === null) throw new Error('material-inward complete without a document')
        const ack = await readAck(supabase, result.documentId, params.tenantId)
        return reply(ack === 'unclear' ? MI_NOT_UNDERSTOOD_CLOSE : MI_DONE)
      }
      case 'duplicate':
        // The SID was already handled (webhook idempotency's second line of defence): no second reply.
        return { reply: '', resolvedFlow: 'invoice' }
      case 'expired':
        // Race: the router read the row as live, the RPC found it expired under the lock and cleared it.
        reportFileAfterSessionEnded(params.media)
        return { reply: MI_SESSION_ENDED_REPLY, resolvedFlow: null }
      case 'idle': {
        // Race: a day-stale reset happened in memory inside the RPC and the row is still 'invoice' (or was cleared
        // meanwhile). Clear it as the router does -- p_now = max(now, expires_at) -- so the ended reply never repeats.
        const now = params.now !== undefined ? new Date(params.now) : new Date()
        const expiresMs = params.expiresAt !== null ? new Date(params.expiresAt).getTime() : now.getTime()
        await expireStaleMaterialInward(params.phoneNumber, new Date(Math.max(now.getTime(), expiresMs)), supabase)
        reportFileAfterSessionEnded(params.media)
        return { reply: MI_SESSION_ENDED_REPLY, resolvedFlow: null }
      }
      case 'wrong_flow': {
        // A check-in started between the router's read and the RPC's lock: the file/answer was not recorded.
        // Decision Q6a: explanation + the current check-in question; no new string.
        const questions =
          result.currentFlow === 'morning'
            ? MORNING_QUESTIONS
            : result.currentFlow === 'evening'
              ? EVENING_QUESTIONS
              : null
        if (questions === null) return { kind: 'wrong_flow_unmapped' }
        return { reply: [CHECKIN_RESET_EXPLAIN_REPLY, questions[result.currentStep] ?? ''].join('\n'), resolvedFlow: null }
      }
    }
  }

  let outcome: MaterialInwardReply | WrongFlowMarker
  if (!filesPresent) {
    outcome = await run()
  } else {
    try {
      outcome = await run()
    } catch (err) {
      // S-F-1: the SID is already consumed (webhook), so a throw here would lose the capture silently. Record and
      // alert with counts and types only, ask for a resend, and let the webhook answer 200.
      Sentry.captureMessage('capture inbound failed', {
        level: 'error',
        fingerprint: ['capture-inbound', 'rpc_failed'],
        tags: { feature: 'capture-inbound' },
        extra: {
          mediaCount: params.media.length,
          contentTypes: params.media.map((m) => m.contentType),
          errorCode: errorCodeOf(err),
        },
      })
      return { reply: MI_CAPTURE_FAILED_REPLY, resolvedFlow: 'invoice' }
    }
  }

  if ('kind' in outcome) {
    // Thrown OUTSIDE the S-F catch on purpose: not a capture failure. Text carries no phone or ids.
    throw new Error('material-inward wrong_flow with a current_flow that is not morning or evening')
  }
  return outcome
}

/**
 * The digit-4 start (p_start_flow = true) from the idle path. Returns the reply, or null when the RPC refused to
 * start because another flow is live (a race): the caller then falls back to today's idle reply. A failure here
 * propagates (a text turn; Q6b).
 */
export async function startMaterialInward(
  params: Pick<
    MaterialInwardTurnParams,
    'phoneNumber' | 'tenantId' | 'userId' | 'projectId' | 'message' | 'messageSid' | 'now'
  >,
  supabaseClient?: SupabaseClient,
): Promise<MaterialInwardReply | null> {
  const supabase = supabaseClient ?? createServiceClient()
  const result = await applyMaterialInwardTurn({
    phoneNumber: params.phoneNumber,
    tenantId: params.tenantId,
    userId: params.userId,
    projectId: params.projectId,
    message: params.message,
    messageSid: params.messageSid,
    startFlow: true,
    ...(params.now !== undefined ? { now: params.now } : {}),
    supabaseClient: supabase,
  })
  const ctx: ReplyContext = {
    supabase,
    phoneNumber: params.phoneNumber,
    tenantId: params.tenantId,
    documentId: result.documentId,
  }
  switch (result.outcome) {
    case 'start':
      return { reply: MI_ASK_KIND, resolvedFlow: 'invoice' }
    case 'reask':
      // Another flow is live (race) -> null. A live 'invoice' session (a concurrent start) -> its current question.
      if (result.currentFlow !== 'invoice') return null
      return { reply: await promptForStep(result.currentStep, ctx), resolvedFlow: 'invoice' }
    case 'duplicate':
      return { reply: '', resolvedFlow: 'invoice' }
    case 'expired':
      return { reply: MI_SESSION_ENDED_REPLY, resolvedFlow: null }
    default:
      // advance / closed / complete / file_attached / idle / wrong_flow cannot follow a start request.
      return null
  }
}
