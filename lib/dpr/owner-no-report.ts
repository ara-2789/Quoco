// §37(d) of design-decisions-beta-feedback.md -- the owner-facing "no
// report today" notice, WhatsApp template 14 (quoco_dpr_owner_no_report,
// HX20e017592136f4fa6fdaf6cb200bf377) and its email fallback (§37(d)/034
// review package §12b -- WhatsApp is optional for owners).
//
// THE SHARED-SOURCE ARGUMENT, per 034 review package §12c -- the constant
// below IS the approved template body, not a paraphrase of it. A shared
// constant alone was found insufficient there (nothing stops the constant
// itself drifting from what is frozen at Meta): the fix is
// test/unit/owner-no-report.test.ts asserting this constant still equals
// the body recorded as approved for this HX SID in
// docs/reviews/whatsapp-template-submission-status.md's own log row -- not
// against docs/whatsapp-templates.json's current draft, which could be
// mid-edit ahead of a resubmission. A wording change becomes "new template
// version + constant change, together," or it doesn't ship.

export const OWNER_NO_REPORT_TEMPLATE_SID = 'HX20e017592136f4fa6fdaf6cb200bf377'

export const OWNER_NO_REPORT_TEMPLATE_BODY =
  'No site report was received for {{1}}, dated {{2}}. There is nothing to share for this date.'

// Fixed lookup, NOT Intl/toLocaleDateString -- checked directly (2026-09-02):
// `toLocaleDateString('en-GB', { month: 'short' })` renders September as
// "Sept" (4 letters), not "Sep" -- a genuine ICU locale quirk, caught by
// this file's own test before it ever reached a real send. Every other
// month happens to already be 3 letters in en-GB, which is exactly the
// kind of one-locale-data-quirk-away-from-a-silent-bug this table avoids
// depending on at all.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Template 14's own sample format ("27 Aug 2026" -- docs/whatsapp-
 * templates.md's own {{2}} sample value) -- deliberately NOT
 * lib/dpr/dispatch.ts's own formatDate ("Thu 13 Aug", no year), which
 * formats the full DPR report, a different, freely-editable surface. This
 * one is frozen the moment Meta approves the template it feeds; changing
 * its shape without a new template version would silently diverge the
 * email fallback from what WhatsApp actually renders.
 */
export function formatOwnerNoticeDate(logDate: string): string {
  const d = new Date(`${logDate}T00:00:00Z`)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = SHORT_MONTHS[d.getUTCMonth()]
  return `${day} ${month} ${d.getUTCFullYear()}`
}

/** WhatsApp Content Variables for template 14 -- {{1}} project, {{2}} date. */
export function buildOwnerNoReportTemplateVariables(projectName: string, logDate: string): Record<string, string> {
  return { '1': projectName, '2': formatOwnerNoticeDate(logDate) }
}

export interface RenderedOwnerNoReportEmail {
  subject: string
  text: string
  html: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Renders the email-fallback version of template 14 -- FROM
 * OWNER_NO_REPORT_TEMPLATE_BODY, substituting the same two placeholders
 * the WhatsApp send substitutes, never a separately-authored sentence.
 * This is what point 2 of §12c's argued shape requires: the two channels
 * must render the same source, not merely start from constants that
 * happen to agree today.
 */
export function renderOwnerNoReportEmail(projectName: string, logDate: string): RenderedOwnerNoReportEmail {
  const formattedDate = formatOwnerNoticeDate(logDate)
  const text = OWNER_NO_REPORT_TEMPLATE_BODY.replace('{{1}}', projectName).replace('{{2}}', formattedDate)
  const subject = `No site report — ${projectName} — ${formattedDate}`
  const html = `<p>${escapeHtml(text)}</p>`
  return { subject, text, html }
}
