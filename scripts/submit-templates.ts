// Submit WhatsApp templates to Meta via the Twilio Content API.
//
// Usage:
//   npx tsx scripts/submit-templates.ts            -- DRY RUN (default). Prints every
//                                                      payload that would be sent. Makes
//                                                      ZERO network calls.
//   npx tsx scripts/submit-templates.ts --submit   -- the real thing. Requires explicit
//                                                      go-ahead each time it's run -- this
//                                                      submits real templates to a real
//                                                      Meta/Twilio account and is not
//                                                      cleanly reversible (a rejected name
//                                                      is blocked from reuse for 30 days).
//
// SOURCE OF TRUTH: docs/whatsapp-templates.md. This script does not retype any copy --
// it parses that file directly, taking only the CURRENT body (the `>` blockquote) for
// each template, never struck-through (~~...~~) prior copy.
//
// CREDENTIALS: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN, read from process.env only.
// Never hardcoded, never logged, never written to disk, never echoed -- including in
// dry-run payload output and error messages. This file itself contains nothing
// sensitive and can be committed.
//
// HARD EXCLUSIONS (in code, not a flag -- see HARD_EXCLUDED_NAMES below):
//   - quoco_engineer_optin (template 8) -- GATE 2 (docs/whatsapp-templates.md HARD
//     GATES): not submitted until messaging_blocked is actually set true in code
//     (BOT-27 SET-HALF).
//   - quoco_safety_alert_pm (template 12) -- Fast-Follow, unbuilt; its CTA button also
//     has no known URL to submit.
//
// RESUMABILITY: writes each successful HX SID + approval status to
// docs/reviews/whatsapp-template-submission-status.md as it goes (one write per
// template, immediately after that template's approval request succeeds) -- a
// mid-batch failure leaves everything before it correctly recorded. A template
// already carrying an HX SID in that file is skipped on the next run (WhatsApp blocks
// reusing a rejected template name for 30 days, so blind re-submission is destructive).
//
// ERROR HANDLING: on any non-2xx from either Twilio call, prints the full response body
// and stops the whole batch immediately (process.exit(1)) -- nothing after the failing
// template is attempted, and the failing template itself is not recorded as submitted.
//
// VERIFY BEFORE --submit, NOT ASSUMED HERE (this project's own standing practice --
// CLAUDE.md's "if a fact you need might have changed since training, say so" rule):
//   - The exact Twilio Content API v1 request/response shapes below (both the
//     twilio/text and twilio/call-to-action content types, and the
//     ApprovalRequests/whatsapp category field's expected casing) against Twilio's
//     current docs. This script has never been run against the real API.
//   - Whether Twilio's call-to-action content type truly resolves button-URL
//     variables from the SAME flat `variables` map as the body, or needs them
//     numbered/scoped separately -- this only matters for template 6
//     (quoco_dpr_ready_pm), the one submittable template with a CTA button.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const TEMPLATES_MD_PATH = resolve(__dirname, '../docs/whatsapp-templates.md')
const STATUS_MD_PATH = resolve(__dirname, '../docs/reviews/whatsapp-template-submission-status.md')

const CONTENT_API_BASE = 'https://content.twilio.com/v1/Content'

// Hard-excluded template names. Checked by literal name, inside parseTemplates,
// before any deep parsing of that template's body/samples/button -- NOT a CLI flag,
// NOT overridable by any argument this script accepts. If a future template needs
// excluding, add its name here; do not add a --skip flag as an alternative.
const HARD_EXCLUDED_NAMES = new Set<string>([
  // GATE 2 (docs/whatsapp-templates.md HARD GATES): not submitted until
  // messaging_blocked is set true in application code (BOT-27 SET-HALF, open
  // since 2026-08-10). An approved template sits in the account and any send path
  // can reach it, so gating submission is what makes this self-enforcing.
  'quoco_engineer_optin',
  // Fast-Follow, unbuilt (CLAUDE.md §2); no dashboard route exists for its CTA
  // button URL either (checked directly -- `find app -iname "*safety*"` returns
  // nothing).
  'quoco_safety_alert_pm',
])

interface ParsedTemplate {
  id: string
  name: string
  category: string
  body: string
  samples: Record<string, string> // "1" -> "Vikram Rao"
  buttonLabel?: string
  buttonUrl?: string
  buttonSampleVar?: string
  buttonSampleValue?: string
}

function fail(msg: string): never {
  console.error(`\nFATAL: ${msg}\n`)
  process.exit(1)
}

function readCredentials(): { accountSid: string; authToken: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    fail(
      'TWILIO_ACCOUNT_SID and/or TWILIO_AUTH_TOKEN are not set in the environment. ' +
        'Set both (in .env.local for local runs, or the real environment) before running ' +
        'this script -- required even in dry-run mode, since dry-run is meant to reflect ' +
        'the real preflight, including the auth header shape. The header value itself is ' +
        'never printed, in either mode.'
    )
  }
  return { accountSid, authToken }
}

function isTemplateIdCell(s: string): boolean {
  return /^[0-9]+[a-zA-Z0-9]*$/.test(s)
}

// Parses docs/whatsapp-templates.md. Returns only templates that are NOT
// hard-excluded and parsed unambiguously. Any parse ambiguity for a
// non-excluded template is fatal for the whole run (see the `ambiguous`
// handling below) -- this script never guesses at copy, category, or samples.
function parseTemplates(markdown: string): ParsedTemplate[] {
  const sections = markdown.split(/\n(?=### )/)
  const templates: ParsedTemplate[] = []
  const ambiguous: string[] = []

  for (const section of sections) {
    const headerMatch = section.match(/^### (\S+)\.\s+`([a-zA-Z0-9_]+)`/)
    if (!headerMatch) continue // not a template section (e.g. "## Spine templates")
    const [, id, name] = headerMatch

    if (HARD_EXCLUDED_NAMES.has(name)) {
      console.log(`SKIP (hard-excluded in code): ${id} ${name}`)
      continue // never deep-parsed -- its metadata is allowed to be incomplete
    }

    // Category: try "**Category: X" first (covers "Category: Utility.",
    // "Category: Utility, but FLAGGED...", "Category: Utility** (shadows...)"),
    // then "**X category**" (covers template 13's "AUTHENTICATION category").
    const metaBlockMatch = section.match(/^### .*?\n([\s\S]*?)\n\n>/)
    const metaBlockRaw = metaBlockMatch ? metaBlockMatch[1] : ''
    const metaBlock = metaBlockRaw.replace(/\n/g, ' ')

    let category: string | null = null
    const catA = metaBlock.match(/\*\*Category:\s*([A-Za-z]+)/)
    if (catA) category = catA[1]
    if (!category) {
      const catB = metaBlock.match(/\*\*([A-Za-z]+)\s+category\*\*/i)
      if (catB) category = catB[1]
    }
    if (!category) {
      ambiguous.push(
        `${id} (${name}): could not extract a Category from the metadata block: ${JSON.stringify(metaBlockRaw.slice(0, 200))}`
      )
      continue
    }
    // Twilio's ApprovalRequests/whatsapp category field is documented as an
    // uppercase enum (UTILITY / MARKETING / AUTHENTICATION) -- VERIFY this
    // against Twilio's current docs before --submit; not independently
    // confirmed against a real API response by this script.
    category = category.toUpperCase()

    // Body: the first contiguous run of "> " lines in this section. Prior
    // (struck-through) copy is always inline `~~...~~` text elsewhere in the
    // section, never a second blockquote, so the first run is always current.
    const bodyMatch = section.match(/\n((?:^> .*\n?)+)/m)
    if (!bodyMatch) {
      ambiguous.push(`${id} (${name}): could not find a blockquote body.`)
      continue
    }
    const bodyLines = bodyMatch[1].split('\n').filter((l) => l.startsWith('> '))
    let buttonLabel: string | undefined
    const textLines: string[] = []
    for (const line of bodyLines) {
      const stripped = line.replace(/^> /, '')
      const btnMatch = stripped.match(/^\[Button:\s*(.+)\]$/)
      if (btnMatch) {
        buttonLabel = btnMatch[1]
        continue // a Meta button is a separate component, not body text
      }
      textLines.push(stripped)
    }
    const body = textLines.join('\n')

    // Sample values: scoped to "**Sample value[s]" .. next blockquote", newlines
    // collapsed so a value that wraps across source lines reconstructs as one
    // string (e.g. template 2's 150-char truncated plan).
    const sampleZoneMatch = section.match(/\*\*Sample values?[\s\S]*?(?=\n>)/)
    const samples: Record<string, string> = {}
    if (sampleZoneMatch) {
      const zone = sampleZoneMatch[0].replace(/\n/g, ' ')
      const pairRe = /`\{\{(\d+)\}\}`\s*=\s*"((?:[^"\\]|\\.)*)"/g
      let m: RegExpExecArray | null
      while ((m = pairRe.exec(zone))) {
        samples[m[1]] = m[2]
      }
    }

    // Every {{n}} referenced in the body must have a sample -- STOP before
    // submitting anything if not, per spec.
    const varsInBody = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((mm) => mm[1]))
    const missingSamples = Array.from(varsInBody).filter((v) => !(v in samples))
    if (missingSamples.length > 0) {
      ambiguous.push(`${id} (${name}): missing sample value(s) for {{${missingSamples.join('}}, {{')}}}}`)
      continue
    }

    let buttonUrl: string | undefined
    let buttonSampleVar: string | undefined
    let buttonSampleValue: string | undefined
    if (buttonLabel) {
      // Same newline-collapsing treatment as the metadata/sample-value zones
      // above -- the source markdown wraps "**Sample\nvalue for the button's..."
      // across a line break, which a literal-space regex against the raw
      // (unflattened) section text will never match.
      const sectionFlat = section.replace(/\n/g, ' ')
      const urlMatch = sectionFlat.match(/Button URL:\s*\*\*`([^`]+)`\*\*/)
      if (!urlMatch) {
        ambiguous.push(
          `${id} (${name}): has a [Button: ...] line but no machine-extractable ` +
            `"Button URL: **\`...\`**" line -- refusing to guess a button URL.`
        )
        continue
      }
      buttonUrl = urlMatch[1]
      const btnSampleMatch = sectionFlat.match(/Sample value for the button's `\{\{(\d+)\}\}`:\s*`([^`]+)`/)
      if (!btnSampleMatch) {
        ambiguous.push(
          `${id} (${name}): has a CTA button URL but no machine-extractable button-variable ` +
            `sample value -- refusing to guess.`
        )
        continue
      }
      buttonSampleVar = btnSampleMatch[1]
      buttonSampleValue = btnSampleMatch[2]
    }

    templates.push({ id, name, category, body, samples, buttonLabel, buttonUrl, buttonSampleVar, buttonSampleValue })
  }

  if (ambiguous.length > 0) {
    console.error('\nParse was ambiguous for the following template(s):\n')
    ambiguous.forEach((a) => console.error(`  - ${a}`))
    fail(
      'Refusing to guess. Propose a structured JSON sidecar (e.g. docs/whatsapp-templates.json, ' +
        '{id, name, category, body, samples, button} per template) for these specific templates ' +
        'rather than relying on markdown parsing for them, then re-run.'
    )
  }

  return templates
}

function loadAlreadySubmitted(statusMd: string): Set<string> {
  const submitted = new Set<string>()
  for (const line of statusMd.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // | | # | Template name | Category | Variant | Submitted | Status | Notes | |
    //   0   1        2            3         4          5          6       7    8
    if (cells.length < 8) continue
    const id = cells[1]
    if (!isTemplateIdCell(id)) continue // header / separator row
    const submittedCell = cells[5] ?? ''
    const notes = cells[7] ?? ''
    if (/HX[0-9a-f]{32}/.test(submittedCell) || /HX[0-9a-f]{32}/.test(notes)) {
      submitted.add(id)
    }
  }
  return submitted
}

function markSubmitted(statusMd: string, id: string, hxSid: string, approvalStatus: string, submittedDate: string): string {
  const lines = statusMd.split('\n')
  const idx = lines.findIndex((line) => {
    if (!line.startsWith('|')) return false
    const cells = line.split('|').map((c) => c.trim())
    return cells.length > 7 && isTemplateIdCell(cells[1]) && cells[1] === id
  })
  if (idx === -1) {
    fail(
      `Could not find a Log-table row for template ${id} in ${STATUS_MD_PATH} -- ` +
        `refusing to append a guessed row shape. Add the row manually, matching the ` +
        `existing table's columns, then re-run.`
    )
  }
  const cells = lines[idx].split('|')
  // cells: ['', ' id ', ' name ', ' category ', ' variant ', ' submitted ', ' status ', ' notes ', '']
  const existingNotes = (cells[7] ?? '').trim()
  const hxNote = `HX SID \`${hxSid}\`, approval request status \`${approvalStatus}\` (submitted ${submittedDate})`
  const newNotes = existingNotes ? `${existingNotes} ${hxNote}` : hxNote
  cells[5] = ` ${submittedDate} `
  cells[6] = ` ${approvalStatus} `
  cells[7] = ` ${newNotes} `
  lines[idx] = cells.join('|')
  return lines.join('\n')
}

function buildCreatePayload(t: ParsedTemplate): Record<string, unknown> {
  const variables: Record<string, string> = { ...t.samples }
  const types: Record<string, unknown> = {}
  if (t.buttonUrl) {
    types['twilio/call-to-action'] = {
      body: t.body,
      actions: [{ type: 'URL', title: t.buttonLabel, url: t.buttonUrl }],
    }
    if (t.buttonSampleVar && t.buttonSampleValue) {
      // Kept in the SAME flat `variables` map as the body's own -- unverified
      // against a real Twilio response, see the file-header VERIFY note.
      variables[t.buttonSampleVar] = t.buttonSampleValue
    }
  } else {
    types['twilio/text'] = { body: t.body }
  }
  return {
    friendly_name: t.name,
    language: 'en',
    variables,
    types,
  }
}

function buildApprovalPayload(t: ParsedTemplate): Record<string, unknown> {
  return {
    name: t.name,
    category: t.category,
  }
}

async function main() {
  const submitMode = process.argv.includes('--submit')
  const { accountSid, authToken } = readCredentials()
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

  const templatesMd = readFileSync(TEMPLATES_MD_PATH, 'utf8')
  const eligible = parseTemplates(templatesMd) // already excludes HARD_EXCLUDED_NAMES

  let statusMd = readFileSync(STATUS_MD_PATH, 'utf8')
  const alreadySubmitted = loadAlreadySubmitted(statusMd)

  const toProcess = eligible.filter((t) => {
    if (alreadySubmitted.has(t.id)) {
      console.log(`SKIP (already has an HX SID recorded in the status doc): ${t.id} ${t.name}`)
      return false
    }
    return true
  })

  console.log(
    `\n${submitMode ? 'SUBMIT MODE -- this will make real Twilio/Meta API calls' : 'DRY RUN (no --submit flag; zero network calls)'} ` +
      `-- ${toProcess.length} template(s) to process\n`
  )

  for (const t of toProcess) {
    const createPayload = buildCreatePayload(t)

    console.log(`\n--- ${t.id} ${t.name} ---`)
    console.log('Step A: POST', CONTENT_API_BASE)
    console.log('Headers:', JSON.stringify({ Authorization: 'Basic <redacted>', 'Content-Type': 'application/json' }, null, 2))
    console.log('Body:', JSON.stringify(createPayload, null, 2))

    if (!submitMode) {
      console.log('(dry run -- not sent; Step B payload would follow the same shape using the HX SID Step A returns)')
      continue
    }

    const createRes = await fetch(CONTENT_API_BASE, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    })
    const createBody = await createRes.json().catch(() => null)
    if (!createRes.ok) {
      console.error(`\nFATAL: Content creation failed for ${t.id} (${t.name}) -- HTTP ${createRes.status}`)
      console.error('Response body:', JSON.stringify(createBody, null, 2))
      fail('Stopping the batch. Nothing further will be submitted. The status doc has not been touched for this template.')
    }
    const hxSid = (createBody as { sid?: string } | null)?.sid
    if (!hxSid) {
      fail(
        `Content creation for ${t.id} (${t.name}) returned 2xx but no "sid" field -- unexpected ` +
          `response shape, refusing to guess. Response: ${JSON.stringify(createBody)}`
      )
    }
    console.log(`Created: ${hxSid}`)

    const approvalUrl = `${CONTENT_API_BASE}/${hxSid}/ApprovalRequests/whatsapp`
    const approvalPayload = buildApprovalPayload(t)
    console.log('Step B: POST', approvalUrl)
    console.log('Body:', JSON.stringify(approvalPayload, null, 2))

    const approvalRes = await fetch(approvalUrl, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(approvalPayload),
    })
    const approvalBody = await approvalRes.json().catch(() => null)
    if (!approvalRes.ok) {
      console.error(`\nFATAL: Approval request failed for ${t.id} (${t.name}) -- HTTP ${approvalRes.status}`)
      console.error('Response body:', JSON.stringify(approvalBody, null, 2))
      console.error(
        `Content WAS created (HX SID ${hxSid}) but the status doc has NOT been updated -- ` +
          `record this SID there manually before re-running, or the next run will attempt to ` +
          `create a duplicate Content resource under the same friendly_name.`
      )
      fail('Stopping the batch.')
    }
    const approvalStatus = (approvalBody as { status?: string } | null)?.status ?? 'unknown'
    console.log(`Approval request submitted, status: ${approvalStatus}`)

    const submittedDate = new Date().toISOString().slice(0, 10)
    statusMd = markSubmitted(statusMd, t.id, hxSid, approvalStatus, submittedDate)
    writeFileSync(STATUS_MD_PATH, statusMd, 'utf8')
    console.log(`Recorded in ${STATUS_MD_PATH}`)
  }

  console.log(`\nDone. ${submitMode ? 'Submitted' : 'Would submit'} ${toProcess.length} template(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
