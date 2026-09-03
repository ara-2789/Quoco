import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  OWNER_NO_REPORT_TEMPLATE_SID,
  OWNER_NO_REPORT_TEMPLATE_BODY,
  formatOwnerNoticeDate,
  buildOwnerNoReportTemplateVariables,
  renderOwnerNoReportEmail,
} from '@/lib/dpr/owner-no-report'

// THE COPY-DRIFT TEST, per 034 review package §12c's own argued shape --
// not against docs/whatsapp-templates.json's current draft (which could be
// mid-edit, pre-resubmission), against the doc that records what Meta
// ACTUALLY approved for this exact HX SID. Reads
// docs/reviews/whatsapp-template-submission-status.md directly at test
// time -- a wording change to OWNER_NO_REPORT_TEMPLATE_BODY without a
// matching new-template-version + submission-status-doc update fails this
// test immediately, which is the entire point (§12c: "a wording change
// becomes 'new template version + constant change,' together, or it
// doesn't ship").
describe('OWNER_NO_REPORT_TEMPLATE_BODY -- copy-drift guard', () => {
  it('equals the body recorded as approved for this exact HX SID in whatsapp-template-submission-status.md', () => {
    const statusDocPath = join(process.cwd(), 'docs/reviews/whatsapp-template-submission-status.md')
    const statusDoc = readFileSync(statusDocPath, 'utf8')

    const anchor = `**Approved body (${OWNER_NO_REPORT_TEMPLATE_SID}):**`
    const anchorIndex = statusDoc.indexOf(anchor)
    expect(anchorIndex, `Could not find the approved-body anchor for ${OWNER_NO_REPORT_TEMPLATE_SID} in ${statusDocPath} -- has the row been edited?`).toBeGreaterThan(-1)

    const afterAnchor = statusDoc.slice(anchorIndex + anchor.length)
    const match = afterAnchor.match(/^\s*`([^`]+)`/)
    expect(match, 'Approved-body anchor found but no backtick-quoted body immediately follows it').not.toBeNull()

    const recordedApprovedBody = match![1]!
    expect(OWNER_NO_REPORT_TEMPLATE_BODY).toBe(recordedApprovedBody)
  })
})

describe('formatOwnerNoticeDate', () => {
  it('matches template 14\'s own sample format ("27 Aug 2026") -- day, short month, full year, no weekday', () => {
    expect(formatOwnerNoticeDate('2026-08-27')).toBe('27 Aug 2026')
  })

  it('zero-pads single-digit days', () => {
    expect(formatOwnerNoticeDate('2026-09-02')).toBe('02 Sep 2026')
  })
})

describe('buildOwnerNoReportTemplateVariables', () => {
  it('builds {{1}}=project, {{2}}=formatted date, nothing else', () => {
    expect(buildOwnerNoReportTemplateVariables('Emerald Heights', '2026-08-27')).toEqual({
      '1': 'Emerald Heights',
      '2': '27 Aug 2026',
    })
  })
})

describe('renderOwnerNoReportEmail', () => {
  it('renders FROM the approved-body constant, substituting the same two placeholders WhatsApp substitutes', () => {
    const rendered = renderOwnerNoReportEmail('Emerald Heights', '2026-08-27')
    expect(rendered.text).toBe('No site report was received for Emerald Heights, dated 27 Aug 2026. There is nothing to share for this date.')
    expect(rendered.subject).toContain('Emerald Heights')
    expect(rendered.subject).toContain('27 Aug 2026')
    expect(rendered.html).toContain('No site report was received for Emerald Heights')
  })

  it('escapes HTML-significant characters in the project name', () => {
    const rendered = renderOwnerNoReportEmail('A & B <Site>', '2026-08-27')
    expect(rendered.html).not.toContain('<Site>')
    expect(rendered.html).toContain('&amp;')
    expect(rendered.html).toContain('&lt;Site&gt;')
  })
})
