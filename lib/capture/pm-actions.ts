import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isReportableErr, mapPmRpcError, pmError, type PmActionName, type PmActionResult } from './pm-errors'
import type { PmErrKey } from './pm-copy'

// PR-D action logic (D7). The five PM writes are the five 050 SECURITY DEFINER functions, called with the SIGNED-IN
// user's client (never the service role): the function re-checks the audience itself (D-20: active user, same tenant,
// project_members.role = 'pm' on the row's own project, 050:507/576/656).
//
// WHY THIS IS NOT IN actions.ts: a 'use server' export is callable from the browser with arbitrary arguments, so it
// must not accept an injected client. The logic lives here with an injectable `deps`; app/(dashboard)/material-inward/
// actions.ts is the thin wrapper that builds deps from the cookie session. Same shape as handlePhotoGet(request,
// params, deps) in app/api/photos/[kind]/[photoId]/route.ts.
//
// VALIDATION IS HAND-WRITTEN, NOT ZOD (build deviation, see docs/plans/pr-d-plan.md): zod is not a declared
// dependency of this repo (it is present only transitively) and package.json is out of scope for this PR.
// Rules mirror the DB: vehicle <= 64 and dc_number <= 64 (049 CHECKs), reason non-blank and <= 1000 (050 N-4),
// delivery_ids 1..20 distinct (050:796-804).
//
// SUCCESS IS NEVER INFERRED: every 050 refusal is a RAISE, so success is `error === null` AND the jsonb result is an
// object carrying the id we sent. Anything else (null, wrong shape, wrong id) is PM_ERR_SAVE_FAILED + Sentry.

export interface PmActionDeps {
  /** The signed-in user's client (RLS + authenticated grants apply). */
  client: SupabaseClient<Database>
  /** public.users row of the caller, already resolved by the wrapper. */
  profile: { id: string; tenant_id: string | null }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DELIVERY_TYPES = ['supplier', 'internal_transfer'] as const

const OK: PmActionResult = { status: 'ok' }

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isIsoDate(v: string): boolean {
  const m = ISO_DATE_RE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Empty or whitespace-only becomes null: a NULL argument clears the field (050:456, "Full overwrite"). */
export function normaliseField(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

function fail(action: PmActionName, key: PmErrKey, detail?: string): PmActionResult {
  if (isReportableErr(key)) {
    Sentry.captureException(new Error(`pm ${action} ${detail ?? 'unknown result'}`), { tags: { feature: 'pr-d-pm-page' } })
  }
  return pmError(key)
}

interface RpcOutcome {
  data: unknown
  error: { code?: string | null; message?: string | null } | null
}

/** Maps an RPC outcome to a result. `idKey` is the jsonb key that must echo `expectedId` for the call to count as success. */
function settle(action: PmActionName, out: RpcOutcome, idKey: string, expectedId: string): PmActionResult {
  if (out.error) {
    const key = mapPmRpcError(action, out.error.code)
    return fail(action, key, `${out.error.code ?? 'no code'}: ${out.error.message ?? ''}`)
  }
  const d = out.data
  if (typeof d === 'object' && d !== null && !Array.isArray(d) && (d as Record<string, unknown>)[idKey] === expectedId) return OK
  return fail(action, 'PM_ERR_SAVE_FAILED', 'result did not echo the id')
}

async function guarded(action: PmActionName, run: () => Promise<PmActionResult>): Promise<PmActionResult> {
  try {
    return await run()
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: 'pr-d-pm-page', action } })
    return pmError('PM_ERR_SAVE_FAILED')
  }
}

// ---------------------------------------------------------------------------------------------------------------
// set details
// ---------------------------------------------------------------------------------------------------------------

export interface PmDetailsFields {
  deliveryType: string | null
  vehicleNumber: string | null
  dcNumber: string | null
  dcDate: string | null
}

export interface PmSetDetailsInput {
  deliveryId: string
  /** The values the form was rendered with (D8). */
  loaded: PmDetailsFields & { status: string }
  /** The values the PM submitted. Empty clears. */
  next: PmDetailsFields
}

function validDetails(f: PmDetailsFields): boolean {
  if (f.deliveryType !== null && !(DELIVERY_TYPES as readonly string[]).includes(f.deliveryType)) return false
  if (f.vehicleNumber !== null && f.vehicleNumber.length > 64) return false
  if (f.dcNumber !== null && f.dcNumber.length > 64) return false
  if (f.dcDate !== null && !isIsoDate(f.dcDate)) return false
  return true
}

function sameDetails(a: PmDetailsFields, b: PmDetailsFields): boolean {
  return (
    normaliseField(a.deliveryType) === normaliseField(b.deliveryType) &&
    normaliseField(a.vehicleNumber) === normaliseField(b.vehicleNumber) &&
    normaliseField(a.dcNumber) === normaliseField(b.dcNumber) &&
    normaliseField(a.dcDate) === normaliseField(b.dcDate)
  )
}

export async function runSetDetails(deps: PmActionDeps, input: PmSetDetailsInput): Promise<PmActionResult> {
  return guarded('set_details', async () => {
    if (!isUuid(input.deliveryId)) return pmError('PM_ERR_INVALID_INPUT')
    if (deps.profile.tenant_id === null) return pmError('PM_ERR_NOT_AVAILABLE')
    const next: PmDetailsFields = {
      deliveryType: normaliseField(input.next.deliveryType),
      vehicleNumber: normaliseField(input.next.vehicleNumber),
      dcNumber: normaliseField(input.next.dcNumber),
      dcDate: normaliseField(input.next.dcDate),
    }
    if (!validDetails(next)) return pmError('PM_ERR_INVALID_INPUT')

    // D8 stale-form check. The form sent the values it loaded; if the row differs now, another PM (or the engineer
    // flow) changed it and a full overwrite would silently discard that. NON-ATOMIC: another PM can still write
    // between this read and the RPC below, and pm_set_delivery_details has no version check (050:518-532). The
    // two-PM race therefore remains a KNOWN RISK with no DB change (T-CONC-1 is CI-only).
    const { data: cur, error: curErr } = await deps.client
      .from('deliveries')
      .select('status, delivery_type, vehicle_number, dc_number, dc_date')
      .eq('id', input.deliveryId)
      .eq('tenant_id', deps.profile.tenant_id)
      .maybeSingle()
    if (curErr) return fail('set_details', 'PM_ERR_SAVE_FAILED', `re-read ${curErr.code ?? 'no code'}`)
    if (!cur) return pmError('PM_ERR_NOT_AVAILABLE')
    const current: PmDetailsFields = {
      deliveryType: cur.delivery_type,
      vehicleNumber: cur.vehicle_number,
      dcNumber: cur.dc_number,
      dcDate: cur.dc_date,
    }
    if (cur.status !== input.loaded.status || !sameDetails(current, input.loaded)) return pmError('PM_ERR_STATE_CHANGED')

    // types/database.ts types these args as non-null `string`, but the function treats NULL as "clear" (050:456-466).
    // The assertions narrow nothing at runtime; the generated file is deliberately not touched by this PR.
    const { data, error } = await deps.client.rpc('pm_set_delivery_details', {
      p_delivery_id: input.deliveryId,
      p_delivery_type: next.deliveryType as string,
      p_vehicle_number: next.vehicleNumber as string,
      p_dc_number: next.dcNumber as string,
      p_dc_date: next.dcDate as string,
    })
    return settle('set_details', { data, error }, 'delivery_id', input.deliveryId)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// approve / reject
// ---------------------------------------------------------------------------------------------------------------

export async function runApprove(deps: PmActionDeps, input: { deliveryId: string }): Promise<PmActionResult> {
  return guarded('approve', async () => {
    if (!isUuid(input.deliveryId)) return pmError('PM_ERR_INVALID_INPUT')
    const { data, error } = await deps.client.rpc('pm_approve_delivery', { p_delivery_id: input.deliveryId })
    return settle('approve', { data, error }, 'delivery_id', input.deliveryId)
  })
}

export async function runReject(deps: PmActionDeps, input: { deliveryId: string; reason: string }): Promise<PmActionResult> {
  return guarded('reject', async () => {
    if (!isUuid(input.deliveryId)) return pmError('PM_ERR_INVALID_INPUT')
    const reason = typeof input.reason === 'string' ? input.reason : ''
    if (reason.trim() === '' || reason.length > 1000) return pmError('PM_ERR_REJECT_REASON')
    const { data, error } = await deps.client.rpc('pm_reject_delivery', { p_delivery_id: input.deliveryId, p_reason: reason.trim() })
    return settle('reject', { data, error }, 'delivery_id', input.deliveryId)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// link / unlink
// ---------------------------------------------------------------------------------------------------------------

export async function runLink(deps: PmActionDeps, input: { invoiceDocumentId: string; deliveryIds: string[] }): Promise<PmActionResult> {
  return guarded('link', async () => {
    const ids = input.deliveryIds
    if (!isUuid(input.invoiceDocumentId) || !Array.isArray(ids) || ids.length < 1 || ids.length > 20) {
      return pmError('PM_ERR_INVALID_INPUT')
    }
    if (!ids.every(isUuid) || new Set(ids).size !== ids.length) return pmError('PM_ERR_INVALID_INPUT')
    const { data, error } = await deps.client.rpc('pm_link_invoice', {
      p_invoice_document_id: input.invoiceDocumentId,
      p_delivery_ids: ids,
    })
    return settle('link', { data, error }, 'invoice_document_id', input.invoiceDocumentId)
  })
}

export async function runUnlink(deps: PmActionDeps, input: { linkId: string }): Promise<PmActionResult> {
  return guarded('unlink', async () => {
    if (!isUuid(input.linkId)) return pmError('PM_ERR_INVALID_INPUT')
    const { data, error } = await deps.client.rpc('pm_unlink_invoice', { p_link_id: input.linkId })
    return settle('unlink', { data, error }, 'link_id', input.linkId)
  })
}
