import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { deriveDprArchiveStatus, type DprArchiveRowInput } from '@/lib/dpr/archive-status'
import { formatIstTime } from './date'

// Read-only DPR delivery note for the DASH-03 correction detail page — one
// query, one plain-language sentence, no write, no regeneration, no resend.
//
// KEYED BY (project_id, engineer_id, log_date) — PROBED, not inferred from
// migration 028's header comments (which quote the OLD constraint as an
// observed catalog fact and so don't settle the question on their own). Live
// on prod, confirmed via a direct pg_constraint read:
//   dprs_project_id_engineer_id_log_date_key  UNIQUE (project_id, engineer_id, log_date)
//   dprs_id_tenant_id_key                     UNIQUE (id, tenant_id)
// The old project-level `dprs_project_id_log_date_key` is gone (028 dropped
// it). dprs is per-engineer, not per-project — this query must NOT drop
// engineer_id from the filter.
//
// REUSES lib/dpr/archive-status.ts's deriveDprArchiveStatus() rather than
// re-deriving DPR state: that function already encodes the correct
// precedence (content present wins outright over generation_status/
// delivery_status, since content is only ever written by the SAME upsert
// that sets generation_status:'idle' — dispatch.ts's success path). A second,
// independent notion of "is the report done" here could disagree with what
// the DPR archive page itself shows for the exact same row — not acceptable
// on a surface whose entire value is honest state.

export type DprDeliveryResult =
  | { status: 'ok'; row: DprArchiveRowInput & { delivered_owner_at: string | null } }
  | { status: 'no-row' }
  | { status: 'error' }

export async function getDprDeliveryState(
  supabase: SupabaseClient<Database>,
  projectId: string,
  engineerId: string,
  logDate: string,
): Promise<DprDeliveryResult> {
  const { data, error } = await supabase
    .from('dprs')
    .select('content, generation_status, delivery_status, delivered_owner_at')
    .eq('project_id', projectId)
    .eq('engineer_id', engineerId)
    .eq('log_date', logDate)
    .maybeSingle()

  if (error) {
    // A failed read here must NOT default to either reassuring bucket ("will
    // be included" / "already sent") — that would be exactly the false
    // promise this section exists to prevent. Sentry-logged and rendered as
    // an honest "couldn't check" line (deriveDprDeliveryCopy's 'error' case),
    // never silently swallowed and never guessed toward the calmer answer.
    Sentry.captureException(error, { tags: { feature: 'dash-03-dpr-delivery-note' } })
    return { status: 'error' }
  }
  if (!data) return { status: 'no-row' }

  return {
    status: 'ok',
    row: {
      content: data.content,
      generation_status: data.generation_status,
      delivery_status: data.delivery_status,
      delivered_owner_at: data.delivered_owner_at,
    },
  }
}

/**
 * Plain-language line for the detail page header. ~6th-grade reading level
 * (design-principles §2.1 — no jargon, no status-enum values on screen).
 * "The report for this day" throughout, never "tonight's report" — a past
 * date is correctable (T-019-08) and the board has a date navigator, so
 * "tonight" is false for any non-today row.
 */
export function deriveDprDeliveryCopy(result: DprDeliveryResult): string {
  if (result.status === 'error') {
    return "Couldn't check whether the report for this day has been sent."
  }
  if (result.status === 'no-row') {
    return "The report for this day hasn't been generated yet. This correction will be included."
  }

  const archiveStatus = deriveDprArchiveStatus(result.row)

  switch (archiveStatus.state) {
    case 'not_generated':
      return "The report for this day hasn't been generated yet. This correction will be included."

    case 'generating':
      // Deliberately NOT the same copy as 'not_generated': generation_status
      // is set to 'running' as a claim, then the row is assembled
      // (lib/dpr/dispatch.ts:100) — a correction can land after the claim but
      // before the assemble read, or after it. That's a race; promising
      // inclusion here would be the exact false assurance this section
      // exists to eliminate.
      return 'The report for this day is being generated right now. This correction may not be included.'

    case 'generated':
      return result.row.delivered_owner_at
        ? `The report for this day was sent to the owner at ${formatIstTime(result.row.delivered_owner_at)}. This correction won't change what they received.`
        : "The report for this day has already been prepared. This correction won't be part of it."

    case 'failed':
      // Distinct from 'no_data' on purpose — this is a software failure
      // (retries exhausted), not a legitimate absence of site data.
      // Conflating the two was corrected here, not left as an earlier draft
      // had it.
      return "Generating the report for this day did not succeed after several tries — the owner received a delay notice instead of a report. This correction isn't part of anything sent."

    case 'no_data':
      // One plain line, minimal design effort by design: archive-status.ts's
      // own dated note says no NEW row can currently carry this status (the
      // roster/union trigger never writes it, and the one historical row was
      // deleted by migration 028). Kept for parity with the shared helper,
      // not because it's expected to fire.
      return "The report for this day was marked as having no site data. This correction won't be part of it."
  }
}
