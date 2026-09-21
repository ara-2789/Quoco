import type { SupabaseClient } from '@supabase/supabase-js'
import { parseRoster, type RosterEntry, type RosterRejection } from '@/lib/engineers/parse-roster'
import { parseCarriedField, sameConfirmedSet } from '@/lib/engineers/confirm-set'

// The add-engineers path (docs/plans/add-engineer-plan.md sections 2, 4, 5).
// PURE ORCHESTRATION over a caller-supplied Supabase client: the server action
// stays thin (client + profile + call here + revalidate) and everything worth
// testing lives here, where vitest can load it ('server-only' cannot load
// under vitest -- test/daily-log-card-photo-gate-render.test.ts documents why).
//
// NO USER-FACING WORDING IN THIS FILE, and no pluralisation or zero-suppression
// (docs/plans/add-engineer-plan.md section 9a): it returns machine identifiers
// (rejection keys, error keys) and the component maps them to
// lib/engineers/copy.ts.
//
// The database function is the authority: authorisation, tenant binding and
// every classification re-run inside add_engineers_to_project on every call.

export interface EngineerInput {
  name: string
  whatsapp_number: string
}

export interface RpcRow {
  idx: number
  status: string
  user_id?: string
  other_project_name?: string
}

export type AddEngineersOutcome =
  | { kind: 'ok'; applied: boolean; rows: RpcRow[] }
  | { kind: 'refused'; reason: 'project_not_found' | 'not_allowed' }
  | { kind: 'batch_conflict' } // 23505 on users_whatsapp_number_key: a concurrent add won (R8)
  | { kind: 'error'; code: string | null }

function isRpcRow(value: unknown): value is RpcRow {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Number.isInteger(v.idx) && typeof v.status === 'string'
}

// Thin wrapper over the RPC, SQLSTATE mapped per the plan's section 5:
//   P0002 no_data_found            -> refused project_not_found
//   42501 insufficient_privilege   -> refused not_allowed
//   23505 unique_violation         -> batch_conflict (the R8 race)
//   anything else (22023 bad argument, 54000 over the cap -- both caller bugs
//   since the parser pre-validates -- or an unknown code) -> error
// p_consent_attested is ALWAYS a boolean: a NULL raises 22023 in both modes.
export async function addEngineersToProject(
  client: SupabaseClient,
  projectId: string,
  engineers: EngineerInput[],
  opts: { dryRun: boolean; consent: boolean },
): Promise<AddEngineersOutcome> {
  const { data, error } = await client.rpc('add_engineers_to_project', {
    p_project_id: projectId,
    p_engineers: engineers,
    p_dry_run: opts.dryRun,
    p_consent_attested: opts.consent,
  })
  if (error) {
    const code = typeof error.code === 'string' ? error.code : ''
    if (code === 'P0002') return { kind: 'refused', reason: 'project_not_found' }
    if (code === '42501') return { kind: 'refused', reason: 'not_allowed' }
    if (code === '23505') return { kind: 'batch_conflict' }
    return { kind: 'error', code: code === '' ? null : code }
  }
  const payload = data as { applied?: unknown; rows?: unknown } | null
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.applied !== 'boolean' ||
    !Array.isArray(payload.rows) ||
    !payload.rows.every(isRpcRow)
  ) {
    return { kind: 'error', code: null }
  }
  return { kind: 'ok', applied: payload.applied, rows: payload.rows }
}

// ---- form state (what the screen renders) ----------------------------------

// Keys into lib/engineers/copy.ts's `rejections` group.
export type RejectionKey =
  | 'noName'
  | 'nameTooLong'
  | 'badNumber'
  | 'duplicateInPaste'
  | 'alreadyOnThisProject'
  | 'onAnotherProject'
  | 'inUse'

export type PreviewRow =
  | { accepted: true; line: string; name: string; number: string }
  | {
      accepted: false
      line: string // exactly as pasted
      name: string
      number: string
      reason: RejectionKey
      otherProjectName?: string
    }

export interface AddedRow {
  name: string
  number: string
}

// Keys into lib/engineers/copy.ts's `errors` group.
export type AddError = 'projectNotFound' | 'notAllowed' | 'emptyList' | 'tooManyLines' | 'unexpected'

export type EngineerFormState =
  | { kind: 'idle' }
  | { kind: 'error'; nonce: string; raw: string; error: AddError; code: string | null }
  | {
      kind: 'preview'
      nonce: string
      raw: string
      // Sorted stored-form numbers the paste yields on the TypeScript side
      // (parsed rows that passed R1-R4). The apply-time set check compares the
      // re-parse against THIS list.
      pasted: string[]
      // Sorted stored-form numbers the dry-run accepted -- the CONFIRMED set,
      // the one whose length the confirm step shows and the only rows sent.
      carried: string[]
      rows: PreviewRow[]
      notice: null | 'list_changed' | 'batch_failed'
    }
  | { kind: 'applied'; nonce: string; added: AddedRow[] }

// A fresh id per response. The client keys its "ticked" and "editing" state to
// it, so any new response clears the attestation tick (a new list needs a new
// attestation, plan 5.2) without an effect.
function newNonce(): string {
  return globalThis.crypto.randomUUID()
}

function rejectionKeyForParse(reason: RosterRejection): RejectionKey {
  switch (reason) {
    case 'no_name':
      return 'noName'
    case 'name_too_long':
      return 'nameTooLong'
    case 'bad_number':
      return 'badNumber'
    case 'duplicate_in_paste':
      return 'duplicateInPaste'
  }
}

type Classified =
  | { ok: true; row: PreviewRow }
  | { ok: false } // an unrecognised status: the whole response is untrusted

// Status -> rejection, per plan section 2.1's table and section 4. Both
// registered_no_project and number_registered read as 'inUse' (D-A4): copy.ts
// deliberately has exactly ONE "already in use" text, because two
// distinguishable texts would reveal whether a number belongs to another company.
function classify(entry: RosterEntry & { accepted: true }, rpc: RpcRow): Classified {
  const base = { line: entry.line, name: entry.name, number: entry.number }
  switch (rpc.status) {
    case 'ok':
      return { ok: true, row: { accepted: true, ...base } }
    case 'already_on_this_project':
      return { ok: true, row: { accepted: false, ...base, reason: 'alreadyOnThisProject' } }
    case 'on_another_project':
      return {
        ok: true,
        row: {
          accepted: false,
          ...base,
          reason: 'onAnotherProject',
          otherProjectName: rpc.other_project_name ?? '',
        },
      }
    case 'registered_no_project':
    case 'number_registered':
      return { ok: true, row: { accepted: false, ...base, reason: 'inUse' } }
    default:
      return { ok: false }
  }
}

function errorFromRefusal(o: Extract<AddEngineersOutcome, { kind: 'refused' | 'batch_conflict' | 'error' }>): {
  error: AddError
  code: string | null
} {
  if (o.kind === 'refused') {
    return { error: o.reason === 'project_not_found' ? 'projectNotFound' : 'notAllowed', code: null }
  }
  return { error: 'unexpected', code: o.kind === 'error' ? o.code : '23505' }
}

function toSendRows(entries: RosterEntry[]): Array<RosterEntry & { accepted: true }> {
  return entries.filter((e): e is RosterEntry & { accepted: true } => e.accepted)
}

// PREVIEW: TypeScript parse (R1-R4), then the function's dry-run (R5-R7) over
// the parsed-acceptable rows only. Writes nothing (T7).
export async function previewEngineers(
  client: SupabaseClient,
  projectId: string,
  raw: string,
): Promise<EngineerFormState> {
  const parsed = parseRoster(raw)
  if (!parsed.ok) {
    return {
      kind: 'error',
      nonce: newNonce(),
      raw,
      error: parsed.error === 'empty' ? 'emptyList' : 'tooManyLines',
      code: null,
    }
  }

  const sendRows = toSendRows(parsed.entries)
  const pasted = sendRows.map((e) => e.number).sort()

  // Nothing acceptable to ask the database about (the function needs 1..50
  // rows): show the rejections as they are.
  if (sendRows.length === 0) {
    const rows: PreviewRow[] = parsed.entries.map((e) =>
      e.accepted
        ? { accepted: true, line: e.line, name: e.name, number: e.number }
        : {
            accepted: false,
            line: e.line,
            name: e.name,
            number: e.number,
            reason: rejectionKeyForParse(e.reason),
          },
    )
    return { kind: 'preview', nonce: newNonce(), raw, pasted, carried: [], rows, notice: null }
  }

  const outcome = await addEngineersToProject(
    client,
    projectId,
    sendRows.map((e) => ({ name: e.name, whatsapp_number: e.number })),
    { dryRun: true, consent: false },
  )
  if (outcome.kind !== 'ok') {
    return { kind: 'error', nonce: newNonce(), raw, ...errorFromRefusal(outcome) }
  }
  // The dry-run must answer once per row sent, in order, with idx 0..n-1.
  if (outcome.rows.length !== sendRows.length || outcome.rows.some((r, i) => r.idx !== i)) {
    return { kind: 'error', nonce: newNonce(), raw, error: 'unexpected', code: null }
  }

  const byNumber = new Map<string, PreviewRow>()
  for (let i = 0; i < sendRows.length; i++) {
    const c = classify(sendRows[i], outcome.rows[i])
    if (!c.ok) return { kind: 'error', nonce: newNonce(), raw, error: 'unexpected', code: null }
    byNumber.set(sendRows[i].number, c.row)
  }

  const rows: PreviewRow[] = parsed.entries.map((e) => {
    if (e.accepted) return byNumber.get(e.number) as PreviewRow
    return {
      accepted: false,
      line: e.line,
      name: e.name,
      number: e.number,
      reason: rejectionKeyForParse(e.reason),
    }
  })
  const carried = rows
    .filter((r): r is Extract<PreviewRow, { accepted: true }> => r.accepted)
    .map((r) => r.number)
    .sort()
  return { kind: 'preview', nonce: newNonce(), raw, pasted, carried, rows, notice: null }
}

export type ApplyOutcome =
  | { kind: 'applied'; nonce: string; added: AddedRow[] }
  | { kind: 'list_changed' }
  | { kind: 'batch_failed' }
  | { kind: 'error'; nonce: string; raw: string; error: AddError; code: string | null }

export interface ApplyInput {
  // The confirmed set: the dry-run's accepted numbers, carried from Confirm.
  carried: string[]
  // The TypeScript-parsed numbers at Preview, carried from Confirm.
  pasted: string[]
  // The attestation tick, recorded not enforced (D9).
  consent: boolean
}

// APPLY: re-parse the text, and refuse -- BEFORE the function is called -- unless
// the re-parse is exactly what was previewed (plan 5.2, S3, T46):
//   1. the re-parsed numbers must equal `pasted` (any edit that changes which
//      numbers parse is drift);
//   2. the rows to send -- the re-parsed rows whose number is in `carried` --
//      must be exactly `carried` (so a forged or stale confirmed list cannot
//      widen or narrow what is written).
// Only then does the apply-mode RPC run, sending only the confirmed rows: rows
// the dry-run rejected (already on this project, in use, ...) must not go,
// because the function is all-or-nothing and would refuse the whole batch.
export async function applyEngineers(
  client: SupabaseClient,
  projectId: string,
  raw: string,
  input: ApplyInput,
): Promise<ApplyOutcome> {
  const parsed = parseRoster(raw)
  if (!parsed.ok) return { kind: 'list_changed' }

  const reparsed = toSendRows(parsed.entries)
  if (!sameConfirmedSet(input.pasted, reparsed.map((e) => e.number))) return { kind: 'list_changed' }

  const confirmed = new Set(input.carried)
  const sendRows = reparsed.filter((e) => confirmed.has(e.number))
  if (sendRows.length === 0 || !sameConfirmedSet(input.carried, sendRows.map((e) => e.number))) {
    return { kind: 'list_changed' }
  }

  const outcome = await addEngineersToProject(
    client,
    projectId,
    sendRows.map((e) => ({ name: e.name, whatsapp_number: e.number })),
    { dryRun: false, consent: input.consent },
  )
  if (outcome.kind === 'batch_conflict') return { kind: 'batch_failed' }
  if (outcome.kind !== 'ok') {
    return { kind: 'error', nonce: newNonce(), raw, ...errorFromRefusal(outcome) }
  }
  // All-or-nothing: anything but applied with every row 'added' means nothing
  // was written.
  if (
    !outcome.applied ||
    outcome.rows.length !== sendRows.length ||
    outcome.rows.some((r, i) => r.idx !== i || r.status !== 'added')
  ) {
    return outcome.applied ? { kind: 'error', nonce: newNonce(), raw, error: 'unexpected', code: null } : { kind: 'batch_failed' }
  }
  return {
    kind: 'applied',
    nonce: newNonce(),
    added: sendRows.map((e) => ({ name: e.name, number: e.number })),
  }
}

// What the apply action returns: the applied result, an error, or -- when the
// list changed or the batch could not be applied -- a fresh PREVIEW of the
// current paste carrying the matching notice. The tick is cleared by the new
// nonce (a new list needs a new attestation).
export async function submitApply(
  client: SupabaseClient,
  projectId: string,
  raw: string,
  input: ApplyInput,
): Promise<EngineerFormState> {
  const outcome = await applyEngineers(client, projectId, raw, input)
  if (outcome.kind === 'applied' || outcome.kind === 'error') return outcome
  const preview = await previewEngineers(client, projectId, raw)
  if (preview.kind !== 'preview') return preview
  return { ...preview, notice: outcome.kind }
}

// Hand validation of the apply form's fields (no schema library: decision
// D-A7). Returns null when a field is malformed; the caller then treats the
// submission as a changed list and re-previews.
export function readApplyFields(form: {
  carried: FormDataEntryValue | null
  pasted: FormDataEntryValue | null
  consent: FormDataEntryValue | null
}): ApplyInput | null {
  const carried = parseCarriedField(form.carried)
  const pasted = parseCarriedField(form.pasted)
  if (carried === null || pasted === null) return null
  return { carried, pasted, consent: form.consent === 'on' }
}
