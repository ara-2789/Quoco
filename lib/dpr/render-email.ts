// §2h of docs/dpr-delivery-versioning-plan.md — a second, email-shaped
// renderer off the SAME dprs.structured this migration 029's versioning
// already stores (Facts assembled once, rendered per-surface — the WhatsApp
// renderer, lib/dpr/render.ts, is itself evidence of exactly this pattern).
// ADDITIVE (2026-06-28 through 2026-09-05): render.ts was not touched by
// this file over that stretch. UPDATED 2026-09-11 (Stage 1 of the DPR
// format redesign, docs/plans/dpr-format-redesign.md §5): this file no
// longer declares its own EngineerReportMeta — it imports render.ts's,
// closing a duplicate-type gap of the exact shape that bit
// narrative-context.ts during migration 040's Stage 2. Reuses
// renderEngineerBody() directly rather than re-deriving the six-section
// body from Facts a second time — email has no WhatsApp-shaped constraint
// on the BODY content itself (it needs no `|`-pair-line mobile workaround),
// only on the WRAPPING, so the body logic has no reason to diverge, only
// the header/verdict wrapper and the HTML escaping around it.
//
// PLAIN TEXT / HTML FIRST, PER §41(b)'s OWN ORDERING — the photo-embed pass
// (§41's owner delivery -> inbound media handling -> ad-hoc menu sequencing)
// comes in a LATER build, once inbound media handling exists; this renderer
// has no photo/embed concept at all yet, deliberately. Which of the two
// outputs below actually gets SENT (plain text vs. HTML, or both) is an
// email-integration decision (§2g, provider not chosen) this file does not
// make — it produces both so that decision can be made downstream without
// a second rendering pass.
//
// SCOPE, NAMED SO IT ISN'T OVERCLAIMED: the HTML output below is a valid,
// renderable HTML document — escaped, line-broken, minimally styled — not
// the richer aligned-table layout the plan's own §2h names as an HTML-only
// option WhatsApp's render deliberately rejected. Building that layout is
// a real design decision (which columns, how much markup) left for
// whoever actually wires the email provider, not decided here by
// omission.
//
// NOT DECIDED HERE, NAMED SO IT ISN'T ASSUMED BY THIS FILE'S SHAPE: whether
// the owner receives ONE email per engineer or one email aggregating every
// engineer report for a project-day. This function renders exactly ONE
// engineer's report, matching what a single `dprs` row actually stores
// (028's per-engineer key widening) — the "how many emails, aggregated
// how" question belongs to whatever job calls this function. BUILT,
// 2026-09-02 (`lib/dpr/owner-deliver-dispatch.ts`): per-engineer, one call
// per row, one email per engineer — but this is recorded as an OPEN
// PRODUCT QUESTION, not a technical decision, since it's the owner's
// actual inbox experience and nobody has looked at a real one yet. Full
// argument: docs/reviews/owner-deliver-handler-record.md, Decision 2. A
// caller wanting one combined email later would still call this once per
// engineer and compose the results — this file's own shape does not need
// to change either way.

import type { EngineerDprFacts, CheckInStatus } from './schema'
import { renderEngineerBody, type EngineerReportMeta } from './render'

export type { EngineerReportMeta }

export interface RenderedCheckInStatus {
  status: CheckInStatus
  reason?: string
}

const CHECK_IN_LABEL: Record<CheckInStatus, string> = {
  complete: 'complete',
  partial: 'partial',
  not_received: 'not received',
  not_applicable: 'not applicable',
}

// STAGE 3 (2026-09-11, docs/plans/dpr-format-redesign.md) -- ONE combined
// line ("Check-in: Morning X · Evening Y"), same reasoning and shape as
// render.ts's own fmtHalf/fmtCombinedCheckInLine. Kept as a separate copy
// here (not imported from render.ts) since neither is exported there --
// same pre-existing pattern this file already used for CHECK_IN_LABEL.
function fmtHalf(label: 'Morning' | 'Evening', s: RenderedCheckInStatus): string {
  const base = `${label} ${CHECK_IN_LABEL[s.status]}`
  return s.status === 'not_applicable' && s.reason ? `${base} — ${s.reason}` : base
}

function fmtCombinedCheckInLine(morning: RenderedCheckInStatus, evening: RenderedCheckInStatus): string {
  return `Check-in: ${fmtHalf('Morning', morning)} · ${fmtHalf('Evening', evening)}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface RenderedEmailReport {
  subject: string
  text: string
  html: string
}

/**
 * Takes: one engineer's already-assembled Facts + verdict + check-in
 * statuses + display meta — the identical shape render.ts's own
 * renderEngineerReport takes for the WhatsApp surface, minus verdictStatus
 * (storage/audit bookkeeping only, unused by any rendering logic in
 * either renderer).
 *
 * Returns: a subject line plus two body renderings (plain text, simple
 * HTML) of the SAME content — no network call, no DB read, no model call.
 * Pure function of its arguments.
 */
// STAGE 3 REWRITE (2026-09-11, docs/plans/dpr-format-redesign.md) -- same
// header shape and SUMMARY-at-the-end ordering as render.ts's own
// renderEngineerReport (see that function's own header comment for the
// full reasoning); subject line is unchanged, an email subject was never
// part of the body-shaped target format. "Project Manager:" omitted when
// null, same as the WhatsApp surface.
export function renderEmailReport(
  facts: EngineerDprFacts,
  verdict: string,
  morningStatus: RenderedCheckInStatus,
  eveningStatus: RenderedCheckInStatus,
  meta: EngineerReportMeta,
): RenderedEmailReport {
  const body = renderEngineerBody(facts)
  const subject = `Daily Progress — ${meta.project_name} — ${meta.formatted_date}`

  // "The sections below are as reported from site." is suppressed when
  // there are no sections (body === '') -- same condition and reasoning
  // as render.ts's own renderEngineerReport fix: a not-on-site day omits
  // WORK/RESOURCE entirely, and this sentence introducing nothing reads
  // as a stray line, not a section header.
  const textLines: string[] = ['Good evening.', `Daily Progress Report — ${meta.project_name}, ${meta.formatted_date}`, '', `Site Engineer: ${meta.engineer_name}`]
  if (meta.project_manager_name !== null) textLines.push(`Project Manager: ${meta.project_manager_name}`)
  textLines.push('', fmtCombinedCheckInLine(morningStatus, eveningStatus))
  if (body.length > 0) textLines.push('', 'The sections below are as reported from site.', '', body)
  // OMIT WHEN EMPTY, 2026-09-12 -- same rule as render.ts's own
  // renderEngineerReport (see that function's own comment): `verdict` is
  // '' whenever the AI summary is disabled (dispatch.ts), and on those
  // days there is nothing to show here at all.
  if (verdict.length > 0) textLines.push('', 'SUMMARY (auto-generated)', verdict)
  const text = textLines.join('\n')

  const htmlMeta = [
    `<p style="margin-top: 4px; color: #555;">Site Engineer: ${escapeHtml(meta.engineer_name)}</p>`,
    meta.project_manager_name !== null ? `<p style="margin-top: 0; color: #555;">Project Manager: ${escapeHtml(meta.project_manager_name)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const htmlBody =
    body.length > 0
      ? [
          `<p style="color: #555;">The sections below are as reported from site.</p>`,
          `<pre style="white-space: pre-wrap; font-family: sans-serif;">${escapeHtml(body)}</pre>`,
        ].join('\n')
      : ''

  // OMIT WHEN EMPTY, 2026-09-12 -- same rule as htmlBody above and as
  // render.ts's own renderEngineerReport: '' whenever the AI summary is
  // disabled, filtered out of the array below like every other empty
  // optional block already is.
  const htmlSummary =
    verdict.length > 0
      ? [`<h3 style="margin-bottom: 4px;">SUMMARY (auto-generated)</h3>`, `<p><strong>${escapeHtml(verdict)}</strong></p>`].join('\n')
      : ''

  const html = [
    `<div style="font-family: sans-serif; max-width: 640px;">`,
    `<p>Good evening.</p>`,
    `<h2 style="margin-bottom: 0;">Daily Progress Report — ${escapeHtml(meta.project_name)}, ${escapeHtml(meta.formatted_date)}</h2>`,
    htmlMeta,
    `<p>${escapeHtml(fmtCombinedCheckInLine(morningStatus, eveningStatus))}</p>`,
    htmlBody,
    htmlSummary,
    `</div>`,
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, text, html }
}
