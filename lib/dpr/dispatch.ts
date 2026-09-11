import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import { assembleEngineerDprFacts } from './assemble'
import { fetchEngineerNarrativeContext } from './narrative-context'
import { generateEngineerVerdict } from './generate'
import { renderEngineerReport, CONTAINMENT_FAILURE_PLACEHOLDER } from './render'
import { resolveProjectManagerName } from './project-manager'
import { correctEngineerWorkText } from './spelling-correction'
import type { CheckInStatus } from './schema'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'

// The dpr_generate job handler — per-engineer report
// (docs/dpr-engineer-report-spec.md). Rewired in place (2026-08-14, plan
// revision 8 implementation) from the OLD project-level handler this same
// function name and job type used to be: there is only one 'dpr_generate'
// job type live in this system, and it now does per-engineer work.
//
// The OLD project-level pipeline this function used to call
// (assembleDprFacts, generateDprJudgment, renderDpr, assembleAccountability
// — all in their own files) is NOT deleted and NOT modified — it stays
// fully intact, exported, and tested (including the golden case,
// lib/dpr/eval/cases/case-complete-two-engineer-day.ts, which calls
// generateDprJudgment directly, never through this file) for the deferred
// project-level report (docs/dpr-engineer-report-spec.md's "Deferred
// decisions" section). This file simply no longer imports or calls it —
// same "leave the old path alone, wire a new one" principle already
// applied throughout this reformat.

export interface DprGenerateJobPayload {
  project_id: string
  engineer_id: string
  log_date: string
}

// PRE-028 PAYLOAD SHAPE GUARD (Aravind's round-4 item 2) — fails loudly,
// not silently. Guards specifically against B3's producer-side failure
// mode (docs/reviews/028-dpr-engineer-report-review-package.md §10): if
// the migration/deploy sequencing ever slips and the dpr-generate cron
// enqueues an OLD-shape payload (no engineer_id) against the NEW deployed
// dispatch.ts, that job must fail visibly — a thrown, Sentry-captured
// error — rather than being silently coerced (e.g. treated as
// engineer_id=undefined and let the upsert throw a much less legible
// Postgres NOT NULL violation three calls deeper).
function assertPostMigrationPayload(payload: DprGenerateJobPayload): void {
  if (!payload.engineer_id || typeof payload.engineer_id !== 'string') {
    throw new Error(
      `dpr_generate payload missing engineer_id — pre-028 payload shape. project_id=${payload.project_id}, log_date=${payload.log_date}. ` +
        'This job was enqueued by code that predates migration 028 (the engineer_id column/key widening) — ' +
        'the dpr-generate cron trigger and this dispatch handler must be on the same deployed version.',
    )
  }
}

// generation_status / delivery_status are ORTHOGONAL lifecycles (023's own
// table comment, docs/schema.md) — unchanged principle from the old
// handler. generation_status only ever reflects THIS handler's own
// compute-job progress; delivery_status is touched ONLY by
// markDprGenerationFailed, below, reserved for failures that prevent a
// report from existing at all (S10) — never for a containment-only
// verdict fallback, which now always produces a deliverable report.
export async function handleDprGenerateJob(
  payload: DprGenerateJobPayload,
  jobId: string,
  deps: { supabaseClient?: SupabaseClient; anthropicClient?: Anthropic } = {},
): Promise<void> {
  assertPostMigrationPayload(payload)

  const client = deps.supabaseClient ?? createServiceClient()
  const anthropic = deps.anthropicClient ?? new Anthropic()

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('name, tenant_id')
    .eq('id', payload.project_id)
    .single()
  if (projectError) throw projectError

  // profile-lookup-guard:allow-id-eq — payload.engineer_id is a resolved
  // users.id (sourced from daily_logs.engineer_id / project_members.user_id
  // via the roster/union trigger), never an auth uid, so the pre-007
  // lookup bug cannot occur here or at this file's other users lookup
  // below (resolveCheckInStatus), which is the same call shape.
  const { data: engineerUser, error: engineerError } = await client
    .from('users')
    .select('full_name')
    .eq('id', payload.engineer_id)
    .single()
  if (engineerError) throw engineerError

  // Claim the row BEFORE the Claude call — B2 key widening: onConflict now
  // includes engineer_id, matching the migration's own widened UNIQUE key.
  const { error: claimError } = await client.from('dprs').upsert(
    {
      project_id: payload.project_id,
      engineer_id: payload.engineer_id,
      tenant_id: project.tenant_id,
      log_date: payload.log_date,
      generation_status: 'running',
      generator_job_id: jobId,
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (claimError) throw claimError

  const timings: Record<string, number> = {}
  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      return await fn()
    } finally {
      timings[label] = Date.now() - start
    }
  }

  const totalStart = Date.now()
  try {
    const assembled = await timed('assembleEngineerDprFacts', () =>
      assembleEngineerDprFacts(client, payload.project_id, payload.engineer_id, payload.log_date),
    )
    const { completeness } = assembled
    // Reassigned below once spelling correction resolves -- let, not const.
    let facts = assembled.facts
    const narrative = await timed('fetchEngineerNarrativeContext', () =>
      fetchEngineerNarrativeContext(client, payload.project_id, payload.engineer_id, payload.log_date),
    )

    const { morning, evening } = await timed('resolveCheckInStatus', () =>
      resolveCheckInStatus(client, payload, completeness),
    )

    // Stage 1 plumbing (2026-09-11, docs/plans/dpr-format-redesign.md §5)
    // -- now rendered (Stage 3): the WORK section's own "Project Manager:"
    // header line.
    const projectManagerName = await timed('resolveProjectManagerName', () =>
      resolveProjectManagerName(client, payload.project_id),
    )

    // Stage 3 (2026-09-11, docs/plans/dpr-format-redesign.md §1) -- spelling
    // correction for WORK's two free-text fields. Runs BEFORE the verdict
    // gate below and BEFORE generateEngineerVerdict, so both the render
    // path and the model see the same (corrected, or raw-fallback) text --
    // never two different versions of what the engineer said. Facts is
    // rebuilt with a new `work` object rather than mutated in place,
    // matching this file's existing preference for constructing new
    // objects over mutation. correctEngineerWorkText itself no-ops (no
    // model call) when neither field has real text.
    const workCorrection = await timed('correctEngineerWorkText', () =>
      correctEngineerWorkText(anthropic, facts.work.planned, facts.work.done_text),
    )
    facts = {
      ...facts,
      work: { ...facts.work, planned_corrected: workCorrection.planned, done_text_corrected: workCorrection.done_text },
    }

    // GATE, corrected (round-4 B1): the verdict sentence summarises what was
    // DONE — that only ever comes from the EVENING half (the morning half
    // is a plan, never an account of work performed). So the model is
    // needed exactly when EVENING has something real to summarize
    // (complete/partial), regardless of morning's own status. A
    // morning-only day (morning complete, evening not_received — the ONLY
    // shape this system has generated in production so far, since the
    // evening flow cannot yet be triggered) is fully code-templated: the
    // spec fixes its verdict as deterministic text (see
    // codeTemplatedVerdict's third branch below), so calling the model to
    // synthesize an already-decided sentence would be a real, nightly,
    // unpriced cost for zero benefit. The OLD gate ("both halves fully
    // determined") was wrong in the other direction too: it routed this
    // exact morning-only shape to the model.
    const eveningNeedsModel = evening.status === 'complete' || evening.status === 'partial'

    let verdict: string
    let verdictStatus: 'model' | 'placeholder' | 'code_templated'
    if (!eveningNeedsModel) {
      verdict = codeTemplatedVerdict(morning, evening)
      verdictStatus = 'code_templated'
    } else {
      const result = await timed('generateEngineerVerdict', () =>
        generateEngineerVerdict(anthropic, facts, narrative, { project_name: project.name, log_date: payload.log_date }),
      )
      if (result.verdict_status === 'placeholder') {
        Sentry.captureException(new Error('DPR verdict containment failed twice, falling back to placeholder'), {
          tags: { feature: 'dpr-generate', failure_class: 'dpr_validation' },
          extra: { project_id: payload.project_id, engineer_id: payload.engineer_id, log_date: payload.log_date },
        })
        verdict = CONTAINMENT_FAILURE_PLACEHOLDER
        verdictStatus = 'placeholder'
      } else {
        verdict = result.verdict
        verdictStatus = 'model'
      }
    }

    const rendered = renderEngineerReport(facts, verdict, verdictStatus, morning, evening, {
      project_name: project.name,
      engineer_name: (engineerUser.full_name as string | null) ?? 'Unnamed engineer',
      formatted_date: formatDate(payload.log_date),
      project_manager_name: projectManagerName,
    })

    await timed('dprsUpsert', async () => {
      const { error } = await client.from('dprs').upsert(
        {
          project_id: payload.project_id,
          engineer_id: payload.engineer_id,
          tenant_id: project.tenant_id,
          log_date: payload.log_date,
          structured: rendered.structured as unknown as Json,
          content: rendered.content,
          generated_at: new Date().toISOString(),
          generation_status: 'idle',
        },
        { onConflict: 'project_id,engineer_id,log_date' },
      )
      if (error) throw error
    })

    console.log(
      JSON.stringify({
        event: 'dpr_generate_timing',
        project_id: payload.project_id,
        engineer_id: payload.engineer_id,
        log_date: payload.log_date,
        steps_ms: timings,
        total_ms: Date.now() - totalStart,
      }),
    )
  } catch (err) {
    // B2 fix (site 2): scoped by engineer_id — an unscoped revert here
    // would touch every engineer's row for this project-day, not just the
    // one that actually failed.
    await client
      .from('dprs')
      .update({ generation_status: 'idle' })
      .eq('project_id', payload.project_id)
      .eq('engineer_id', payload.engineer_id)
      .eq('log_date', payload.log_date)

    throw err
  }
}

// Holiday / fully-not_applicable / morning-only / fully-empty days —
// code-templated, no model call (Rule 2's "code already knows the whole
// answer" pattern, applied to the verdict the same way schema.ts's
// DataStatus sections already apply it). Deliberately not exhaustive prose
// — one honest sentence per state. ONLY ever called when evening is NOT
// complete/partial (the caller's eveningNeedsModel gate) — so every branch
// here can assume evening has nothing real to report; only morning's
// status distinguishes the remaining cases.
function codeTemplatedVerdict(morning: CheckInStatusResult['morning'], evening: CheckInStatusResult['evening']): string {
  // Structural check (round-4 NIT) — kind, not a substring match on reason
  // text. The old `.reason?.includes('holiday')` coupled this branch to the
  // exact copy resolveCheckInStatus happens to write into `reason` today;
  // any future edit to that plain-language copy (the spec mandates it will
  // be edited) would silently break this check without either function
  // knowing the other depends on it.
  if (morning.kind === 'holiday' || evening.kind === 'holiday') {
    return 'Site closed today.'
  }
  // Not-on-site (Stage 4, 2026-09-11, docs/plans/dpr-format-redesign.md
  // §9). Checked structurally, same discipline as the holiday branch
  // above — never a substring match on `reason`. Only reached when
  // eveningNeedsModel is false (this function's own caller-gate), i.e.
  // evening has nothing real either — "no real reported content," exactly
  // the condition Aravind's instruction names. PROPOSED TEXT, not yet
  // confirmed copy — flagged for approval in the same review round that
  // added this branch, not invented-and-shipped silently.
  if (morning.kind === 'not_on_site') {
    return 'Engineer not on site today.'
  }
  if (morning.status === 'not_applicable' && evening.status === 'not_applicable') {
    return `${morning.reason ?? evening.reason ?? 'Added to this project after today\'s check-in window'} — first report covers the next check-in.`
  }
  // B1 — morning-real / evening-missing: the spec's own sample fixes this
  // verdict as deterministic text (docs/dpr-engineer-report-spec.md's
  // morning-only sample), not something to ask the model to synthesize.
  // This is the day shape prod actually produces every night until the
  // evening flow can be triggered — the untested branch that fires first.
  if (morning.status === 'complete' || morning.status === 'partial') {
    return 'No evening check-in, so we do not know what was done today.'
  }
  return 'No check-in received today, so we do not know what was done.'
}

// Exported 2026-09-02 so the owner-deliver handler (lib/dpr/owner-deliver-
// dispatch.ts) renders the same date format for the same report's email
// copy, rather than a second, independently-maintained formatter that
// could silently drift from this one.
export function formatDate(logDate: string): string {
  // e.g. "Thu 13 Aug" — code-side, never fed through containment (S1).
  const d = new Date(`${logDate}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
}

// Structural discriminator for WHY a half is not_applicable — round-4 NIT.
// Exists so codeTemplatedVerdict (and any future reader) branches on a
// stable code, not on substring-matching the plain-language `reason` text,
// which the spec explicitly expects to be edited over time.
// 'not_on_site' ADDED Stage 4 (2026-09-11, docs/plans/dpr-format-redesign.md
// §8/§9) — see resolveCheckInStatus's own comment on the attendance='absent'
// branch for why this exists and what it fixes.
type NotApplicableKind = 'holiday' | 'joined_late' | 'left_early' | 'not_on_site'

export interface CheckInStatusResult {
  morning: { status: CheckInStatus; reason?: string; kind?: NotApplicableKind }
  evening: { status: CheckInStatus; reason?: string; kind?: NotApplicableKind }
  // Stage 1 plumbing (2026-09-11, docs/plans/dpr-format-redesign.md §8).
  // Read straight from daily_logs.attendance (migration 030) -- null when
  // no daily_logs row exists (a genuinely silent engineer) or the value
  // hasn't been captured yet. Not yet consumed by anything: this field
  // exists so it can be read and tested independently of the render
  // change (Stage C) that will actually branch on it. `attendance ===
  // 'absent'` is the real "not-on-site" case (§8) -- 'site_holiday'
  // already flows into the `kind: 'holiday'` branch above via is_holiday.
  attendance: 'present' | 'absent' | 'site_holiday' | null
}

function checkpointMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Overlays holiday / not_applicable (both directions — joined late, left
// early) onto the raw complete/partial/not_received completeness already
// computed from Facts (assembleEngineerDprFacts). This is the ONE place
// project_members timing (spec Rule 7) and holiday status get read —
// deliberately kept out of assemble.ts, which has no reason to know about
// roster membership at all.
export async function resolveCheckInStatus(
  client: SupabaseClient,
  payload: DprGenerateJobPayload,
  completeness: { morning: CheckInStatus; evening: CheckInStatus },
): Promise<CheckInStatusResult> {
  const { data: log } = await client
    .from('daily_logs')
    .select('is_holiday, holiday_reason, attendance')
    .eq('project_id', payload.project_id)
    .eq('engineer_id', payload.engineer_id)
    .eq('log_date', payload.log_date)
    .maybeSingle()

  const attendance = (log?.attendance as 'present' | 'absent' | 'site_holiday' | null) ?? null

  if (log?.is_holiday) {
    const reason = (log.holiday_reason as string | null)?.trim()
    const text = reason ? `Site closed — ${reason} (holiday)` : 'Site closed (holiday)'
    return {
      morning: { status: 'not_applicable', reason: text, kind: 'holiday' },
      evening: { status: 'not_applicable', reason: text, kind: 'holiday' },
      attendance,
    }
  }

  const { data: membership } = await client
    .from('project_members')
    .select('created_at')
    .eq('project_id', payload.project_id)
    .eq('user_id', payload.engineer_id)
    .maybeSingle()

  const { data: engineer } = await client.from('users').select('status').eq('id', payload.engineer_id).single()
  const stillActiveMember = membership !== null && engineer?.status === 'active'

  const overlayHalf = (half: CheckInStatus, checkpointHHMM: string): { status: CheckInStatus; reason?: string; kind?: NotApplicableKind } => {
    if (half === 'complete' || half === 'partial') return { status: half }

    // Joined-late: membership began after this half's send time, on this
    // log_date. spec Rule 7 — send-time threshold, IST-explicit.
    if (membership?.created_at) {
      const created = istParts(new Date(membership.created_at as string))
      if (created.date === payload.log_date && created.minutes > checkpointMinutes(checkpointHHMM)) {
        return { status: 'not_applicable', reason: 'joined this project today', kind: 'joined_late' }
      }
    }

    // Left-early (round-3 NIT): real data exists somewhere today (the
    // union check that got this engineer a job at all) but this engineer
    // is no longer an active member — an un-owed half reads not_applicable,
    // never not_received.
    const hasRealDataToday = completeness.morning !== 'not_received' || completeness.evening !== 'not_received'
    if (!stillActiveMember && hasRealDataToday) {
      return { status: 'not_applicable', reason: 'left this project during the day', kind: 'left_early' }
    }

    return { status: half }
  }

  // Not-on-site (Stage 4, 2026-09-11, docs/plans/dpr-format-redesign.md
  // §8). MORNING ONLY — overrides whatever overlayHalf/deriveHalfCompleteness
  // would otherwise say. Real bug this fixes: the morning flow's own
  // attendance='absent' path (lib/whatsapp/flows/morning.ts) completes at
  // Q1, setting morning_submitted_at with morning_plan/morning_manpower/
  // morning_equipment all still null — deriveHalfCompleteness
  // (assemble.ts) reads "morning_submitted_at set" alone as 'complete',
  // with no way to know WHY nothing was captured. Left as 'complete',
  // codeTemplatedVerdict's own "morning.status === 'complete'" branch
  // would print "No evening check-in, so we do not know what was done
  // today" — implying the engineer worked and the OUTCOME is merely
  // unknown, when nothing was worked on at all. Evening is UNAFFECTED —
  // independent of morning attendance (MORNING_ABSENT_REPLY's own copy:
  // "We'll still check in this evening") — still goes through the
  // ordinary overlay below, so a real evening check-in still reaches the
  // real verdict model exactly as today.
  if (attendance === 'absent') {
    return {
      morning: { status: 'not_applicable', reason: 'not on site today', kind: 'not_on_site' },
      evening: overlayHalf(completeness.evening, CHECKIN_CHECKPOINTS.eveningSend),
      attendance,
    }
  }

  return {
    morning: overlayHalf(completeness.morning, CHECKIN_CHECKPOINTS.morningSend),
    evening: overlayHalf(completeness.evening, CHECKIN_CHECKPOINTS.eveningSend),
    attendance,
  }
}

// Called from app/api/jobs/tick/route.ts ONLY after failJob reports
// willRetry: false for a dpr_generate job — reserved for failures that
// prevent a report from existing at all (an assembler throw, an
// unrecoverable DB error) — NEVER for a containment-only verdict fallback,
// which S10 (round 3) established always produces a deliverable report
// and never reaches this function. B2 fix (site 3): scoped by
// engineer_id, same reasoning as the error-path revert above.
export async function markDprGenerationFailed(
  client: SupabaseClient,
  project_id: string,
  engineer_id: string,
  log_date: string,
): Promise<void> {
  const { error } = await client
    .from('dprs')
    .update({ delivery_status: 'failed', generation_status: 'idle' })
    .eq('project_id', project_id)
    .eq('engineer_id', engineer_id)
    .eq('log_date', log_date)
  if (error) throw error
}
