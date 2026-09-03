// §2h of docs/dpr-delivery-versioning-plan.md — a second, email-shaped
// renderer off the SAME dprs.structured this migration 029's versioning
// already stores (Facts assembled once, rendered per-surface — the WhatsApp
// renderer, lib/dpr/render.ts, is itself evidence of exactly this pattern).
// ADDITIVE: render.ts is not touched by this file. Reuses
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
import { renderEngineerBody } from './render'

export interface RenderedCheckInStatus {
  status: CheckInStatus
  reason?: string
}

export interface EngineerReportMeta {
  project_name: string
  engineer_name: string
  // Pre-formatted, code-side — same convention as render.ts's own
  // EngineerReportMeta (never derived from a digit inside the containment
  // corpus).
  formatted_date: string
}

const CHECK_IN_LABEL: Record<CheckInStatus, string> = {
  complete: 'complete',
  partial: 'partial',
  not_received: 'not received',
  not_applicable: 'not applicable',
}

function checkInLine(label: 'Morning' | 'Evening', s: RenderedCheckInStatus): string {
  const base = `${label} check-in: ${CHECK_IN_LABEL[s.status]}`
  return s.status === 'not_applicable' && s.reason ? `${base} — ${s.reason}` : base
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
export function renderEmailReport(
  facts: EngineerDprFacts,
  verdict: string,
  morningStatus: RenderedCheckInStatus,
  eveningStatus: RenderedCheckInStatus,
  meta: EngineerReportMeta,
): RenderedEmailReport {
  const body = renderEngineerBody(facts)
  const subject = `Daily Progress — ${meta.project_name} — ${meta.formatted_date}`

  const textLines: string[] = []
  textLines.push(`Daily Progress — ${meta.project_name} — ${meta.formatted_date}`)
  textLines.push(`Site engineer: ${meta.engineer_name}`)
  textLines.push('')
  textLines.push(checkInLine('Morning', morningStatus))
  textLines.push(checkInLine('Evening', eveningStatus))
  textLines.push('')
  textLines.push(verdict)
  textLines.push('')
  textLines.push(body)
  const text = textLines.join('\n')

  const html = [
    `<div style="font-family: sans-serif; max-width: 640px;">`,
    `<h2 style="margin-bottom: 0;">${escapeHtml(meta.project_name)}</h2>`,
    `<p style="margin-top: 4px; color: #555;">${escapeHtml(meta.formatted_date)} — Site engineer: ${escapeHtml(meta.engineer_name)}</p>`,
    `<p>${escapeHtml(checkInLine('Morning', morningStatus))}<br>${escapeHtml(checkInLine('Evening', eveningStatus))}</p>`,
    `<p><strong>${escapeHtml(verdict)}</strong></p>`,
    `<pre style="white-space: pre-wrap; font-family: sans-serif;">${escapeHtml(body)}</pre>`,
    `</div>`,
  ].join('\n')

  return { subject, text, html }
}
