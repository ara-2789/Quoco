import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/types/database'

// Part A of docs/plans/dpr-owner-pass-regeneration.md — routes both
// dpr-generation call sites (lib/dpr/dispatch.ts, scripts/generate-one-
// dpr.ts) through write_dpr_version (migration 029) instead of a raw
// `.from('dprs').upsert(...)`, so every generation appends a dpr_versions
// row rather than silently overwriting the prior render. No schema change
// — the RPC and both tables already exist and were already externally
// reviewed under 029 (B1/B2/B3 fixed, re-verified per that migration's own
// review package).
//
// THREE THINGS write_dpr_version CANNOT DO ITSELF, all handled here:
//
// 1. It requires an EXISTING dprs.id — its own signature is
//    (p_dpr_id, p_content, p_structured, p_generated_by, p_generated_by_user),
//    no project_id/engineer_id/log_date, so it cannot create a row. A shell
//    upsert (identity columns only, no content) ensures one exists and
//    returns its id, for a caller that doesn't already have it.
//    dispatch.ts's own claim step already creates the row earlier in its
//    flow (generation_status='running') — pass `dprId` directly there and
//    this function skips the shell upsert entirely.
//
// 2. EVERY dprs row created before this file existed carries real content
//    (or none) from the OLD raw-upsert path with ZERO corresponding
//    dpr_versions rows. write_dpr_version's own `current_version + 1`
//    arithmetic would silently overwrite that content with no history the
//    FIRST time it is ever called against such a row — the identical
//    "phantom v1" shape 029's own migration-time backfill fixed once, for
//    the single row that existed then (docs/reviews/029-dpr-versioning-
//    review-package.md, finding B3). Every row created since 029 shipped
//    has the same unaddressed gap — there is no reason to believe it is
//    still just one row. Self-healing per row, not a one-time backfill
//    migration: if the target row already has content and zero
//    dpr_versions rows, synthesize a version-1 dpr_versions row from that
//    EXISTING content before calling the RPC. No-op on every later call —
//    the "zero dpr_versions rows" check is then false. This is a DIRECT
//    table INSERT, not the RPC: write_dpr_version can only ever write
//    current_version+1, never an exact backfill version number, and
//    changing that would be a function-logic change (out of this PR's
//    scope — no migration, no function edit). The insert relies on
//    service_role's own ability to write dpr_versions directly, which is
//    the ALREADY-DOCUMENTED, separately-tracked grants gap (CLAUDE.md's "A
//    TABLE-LEVEL REVOKE MUST NAME service_role EXPLICITLY" entry) — this
//    is the one place in the app that leans on that gap deliberately,
//    not a new one, and it needs re-examining if that gap is ever closed.
//    A concurrent racer hitting the same backfill is caught by
//    dpr_versions' own UNIQUE (dpr_id, version) constraint (23505),
//    treated as "someone else already wrote it," not a failure.
//
// 3. write_dpr_version's own UPDATE touches content/structured/
//    current_version/generated_by/generated_by_user/last_regenerated_at —
//    it does NOT touch generation_status OR generated_at. The old raw
//    upsert set BOTH explicitly on every write; generated_at has no DB
//    default (023_dpr_reports.sql:129 — nullable, no DEFAULT), so leaving
//    it alone here would silently leave it NULL forever on any row this
//    path ever creates. Both are set together, separately, after the RPC
//    succeeds, matching the old upsert's values exactly.

export interface WriteDprVersionParams {
  client: SupabaseClient
  /** Already-known dprs.id (e.g. dispatch.ts's own claim step). Omit to let this function ensure the row exists via a shell upsert. */
  dprId?: string
  projectId: string
  engineerId: string
  tenantId: string
  logDate: string
  content: string
  structured: Json
}

export async function writeDprVersion(params: WriteDprVersionParams): Promise<void> {
  const { client } = params
  const dprId = params.dprId ?? (await ensureDprRow(params))

  await backfillPhantomFirstVersion(client, dprId, params.tenantId)

  const { error: rpcError } = await client.rpc('write_dpr_version', {
    p_dpr_id: dprId,
    p_content: params.content,
    p_structured: params.structured,
    p_generated_by: 'system',
    p_generated_by_user: null,
  })
  if (rpcError) throw rpcError

  const { error: statusError } = await client
    .from('dprs')
    .update({ generation_status: 'idle', generated_at: new Date().toISOString() })
    .eq('id', dprId)
  if (statusError) throw statusError
}

async function ensureDprRow(params: WriteDprVersionParams): Promise<string> {
  const { data, error } = await params.client
    .from('dprs')
    .upsert(
      { project_id: params.projectId, engineer_id: params.engineerId, tenant_id: params.tenantId, log_date: params.logDate },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function backfillPhantomFirstVersion(client: SupabaseClient, dprId: string, tenantId: string): Promise<void> {
  const { data: row, error: rowError } = await client
    .from('dprs')
    .select('content, structured, current_version, generated_by, generated_by_user, generated_at')
    .eq('id', dprId)
    .single()
  if (rowError) throw rowError
  if (row.content === null) return // nothing pre-existing to preserve

  const { count, error: countError } = await client.from('dpr_versions').select('id', { count: 'exact', head: true }).eq('dpr_id', dprId)
  if (countError) throw countError
  if (count && count > 0) return // already has history — not a first touch

  const { error: insertError } = await client.from('dpr_versions').insert({
    tenant_id: tenantId,
    dpr_id: dprId,
    version: row.current_version as number,
    generated_by: row.generated_by as string,
    generated_by_user: row.generated_by_user as string | null,
    content: row.content as string,
    structured: row.structured as Json,
    // dpr_versions.created_at defaults to now() and is NOT NULL -- every
    // real pre-Part-A row has a real generated_at (the old upsert always
    // set it), but fall back rather than pass an explicit null that would
    // violate the NOT NULL constraint on some future, unanticipated row.
    ...(row.generated_at ? { created_at: row.generated_at as string } : {}),
  })
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') return
    throw insertError
  }
}
