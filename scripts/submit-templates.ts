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
// SOURCE OF TRUTH (2026-08-21, standing decision after three markdown-parsing failures):
// docs/whatsapp-templates.json ONLY. This script no longer parses
// docs/whatsapp-templates.md's copy in any way -- that parser is deleted, not kept as a
// fallback. Origin: three real parsing defects surfaced against the markdown parser this
// same session --
//   1. a line-wrap in the source markdown ("**Sample\nvalue for the button's...") that a
//      literal-space regex never matched, which the parser caught and refused to guess on;
//   2. the CTA button's variable numbering, documented wrong in the markdown itself
//      ({{1}} instead of {{3}}), which collided with the body's own {{1}} in the flat
//      variables map;
//   3. markdown strikethrough (~~...~~) that the parser didn't understand, so a
//      struck-through "prior sample values" aside sitting in the same scan zone as a
//      correction could silently win the dict-assignment race -- and DID: templates 2 and
//      2v2 re-emitted their old REAL sample values after the markdown had already been
//      correctly edited, with no error, no crash, nothing to notice.
// The third failure is why this script stopped parsing markdown at all: it did not fail
// loudly -- it produced a plausible, wrong result, exactly the failure mode a human
// reviewing script output is least likely to catch. docs/whatsapp-templates.md remains
// the human-readable record; docs/whatsapp-templates.json is the machine record this
// script actually reads, generated once by hand against the markdown and kept in sync by
// hand from here -- see checkDriftAgainstMarkdown() (template presence) and
// checkBodyDriftAgainstMarkdown() (2026-08-22, body wording, whitespace-normalised) for
// the checks that catch the two drifting apart.
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
// NOT INCLUDED HERE, DELIBERATELY -- a separate, standalone check, not wired into this
// script's automatic execution path: the 2026-08-21 DB drift guard (does any sample value
// in the JSON match a real users.full_name / projects.name / tenants.name / dprs.id in
// prod). That check requires a live Supabase query -- a real network call -- which would
// break this script's own "dry run makes ZERO network calls" guarantee if it ran
// unconditionally on every invocation. Run it by hand (see the query in this session's
// own record) before trusting a freshly-edited JSON file, rather than assuming this
// script re-verifies it for you.
//
// VERIFY BEFORE --submit, NOT ASSUMED HERE (this project's own standing practice --
// CLAUDE.md's "if a fact you need might have changed since training, say so" rule):
//   - The exact Twilio Content API v1 request/response shapes below (both the
//     twilio/text and twilio/call-to-action content types, and the
//     ApprovalRequests/whatsapp category field's expected casing) against Twilio's
//     current docs. This script has never been run against the real API.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const TEMPLATES_JSON_PATH = resolve(__dirname, '../docs/whatsapp-templates.json')
// Read ONLY for the drift check's header scan below -- never for body/category/
// samples/button content. See checkDriftAgainstMarkdown().
const TEMPLATES_MD_PATH = resolve(__dirname, '../docs/whatsapp-templates.md')
const STATUS_MD_PATH = resolve(__dirname, '../docs/reviews/whatsapp-template-submission-status.md')

const CONTENT_API_BASE = 'https://content.twilio.com/v1/Content'

// Hard-excluded template names. Checked by literal name, before anything else touches
// a template -- NOT a CLI flag, NOT overridable by any argument this script accepts.
const HARD_EXCLUDED_NAMES = new Set<string>([
  // GATE 2 (docs/whatsapp-templates.md HARD GATES): not submitted until
  // messaging_blocked is set true in application code (BOT-27 SET-HALF, open
  // since 2026-08-10).
  'quoco_engineer_optin',
  // Fast-Follow, unbuilt (CLAUDE.md §2); no dashboard route exists for its CTA
  // button URL either.
  'quoco_safety_alert_pm',
])

interface ButtonSpec {
  label: string
  url: string
  sampleVar: string
  sampleValue: string
}

interface ParsedTemplate {
  id: string
  name: string
  category: string
  body: string
  samples: Record<string, string>
  button: ButtonSpec | null
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

function loadTemplatesFromJson(): ParsedTemplate[] {
  let raw: string
  try {
    raw = readFileSync(TEMPLATES_JSON_PATH, 'utf8')
  } catch (e) {
    fail(`Could not read ${TEMPLATES_JSON_PATH}: ${(e as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    fail(`${TEMPLATES_JSON_PATH} is not valid JSON: ${(e as Error).message}`)
  }
  if (!Array.isArray(parsed)) {
    fail(`${TEMPLATES_JSON_PATH} must be a JSON array of template objects.`)
  }
  const templates = parsed as ParsedTemplate[]

  // Fail loudly on any malformed entry rather than silently proceeding with an
  // incomplete object -- same "STOP before submitting anything" discipline the
  // deleted markdown parser had, just against a much simpler, hand-authored source.
  for (const t of templates) {
    if (!t.id || !t.name || !t.category || !t.body || !t.samples) {
      fail(`Malformed entry in ${TEMPLATES_JSON_PATH}: ${JSON.stringify(t)}`)
    }
    if (t.button !== null) {
      if (!t.button || !t.button.label || !t.button.url || !t.button.sampleVar || !t.button.sampleValue) {
        fail(`${t.id} (${t.name}): "button" must be null or a complete {label, url, sampleVar, sampleValue} object.`)
      }
    }
    const varsInBody = new Set(Array.from(t.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]))
    const missing = Array.from(varsInBody).filter((v) => !(v in t.samples))
    if (missing.length > 0) {
      fail(`${t.id} (${t.name}): missing sample value(s) in the JSON for {{${missing.join('}}, {{')}}}}`)
    }
  }

  return templates
}

// Drift guard: the JSON must declare exactly the same set of {id, name} pairs the
// markdown's own "### id. `name`" headers declare -- NOT a re-parse of body, category,
// samples, or button (that parser is deleted; see the file header). This only
// enumerates template PRESENCE in the markdown, nothing about its content, so it
// cannot reproduce any of the three failure classes that killed the content parser.
function checkDriftAgainstMarkdown(templates: ParsedTemplate[]): void {
  let md: string
  try {
    md = readFileSync(TEMPLATES_MD_PATH, 'utf8')
  } catch (e) {
    fail(`Could not read ${TEMPLATES_MD_PATH} for the drift check: ${(e as Error).message}`)
  }
  const headerRe = /^### (\S+)\.\s+`([a-zA-Z0-9_]+)`/gm
  const mdTemplates = new Map<string, string>() // id -> name
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(md))) {
    mdTemplates.set(m[1], m[2])
  }

  const missingFromJson: string[] = []
  for (const [id, name] of mdTemplates) {
    if (!templates.some((t) => t.id === id)) missingFromJson.push(`${id} (${name})`)
  }
  const missingFromMd: string[] = []
  const nameMismatches: string[] = []
  for (const t of templates) {
    const mdName = mdTemplates.get(t.id)
    if (!mdName) {
      missingFromMd.push(`${t.id} (${t.name})`)
    } else if (mdName !== t.name) {
      nameMismatches.push(`${t.id}: JSON says "${t.name}", markdown says "${mdName}"`)
    }
  }

  if (missingFromJson.length > 0 || missingFromMd.length > 0 || nameMismatches.length > 0) {
    console.error('\nDrift detected between docs/whatsapp-templates.json and docs/whatsapp-templates.md:\n')
    missingFromJson.forEach((s) => console.error(`  - present in markdown, missing from JSON: ${s}`))
    missingFromMd.forEach((s) => console.error(`  - present in JSON, missing from markdown: ${s}`))
    nameMismatches.forEach((s) => console.error(`  - name mismatch: ${s}`))
    fail(
      'The JSON sidecar and the markdown have drifted apart. Update docs/whatsapp-templates.json ' +
        'by hand to match the markdown (this script never re-derives it automatically), then re-run.'
    )
  }
}

// Extracts a template's CURRENT body from its markdown section -- struck-through
// (~~...~~) text stripped first, [Button: ...] lines excluded -- for the content-drift
// comparison below ONLY. This is never used to build a submission payload; the JSON
// remains the sole source for that. Returns null if no blockquote body can be found,
// which the caller treats as a hard failure, not a skip.
function extractCurrentMarkdownBody(section: string): string | null {
  const sectionLive = section.replace(/~~[\s\S]*?~~/g, '')
  const bodyMatch = sectionLive.match(/\n((?:^> .*\n?)+)/m)
  if (!bodyMatch) return null
  const bodyLines = bodyMatch[1].split('\n').filter((l) => l.startsWith('> '))
  const textLines: string[] = []
  for (const line of bodyLines) {
    const stripped = line.replace(/^> /, '')
    if (/^\[Button:\s*.+\]$/.test(stripped)) continue // button line, not body text
    textLines.push(stripped)
  }
  return textLines.join('\n')
}

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim()
}

// Content-drift guard (2026-08-22): the header-presence check above catches a
// template appearing or vanishing, but a JSON body that has silently diverged in
// WORDING from the markdown's own current body goes completely undetected by it --
// the strike-through bug's shape one level up. The JSON is what actually gets
// submitted to Meta; the markdown is what a human reads and corrects. A silent
// divergence between them means a human-approved fix made in the markdown would
// never reach Meta, with nothing surfacing that fact.
//
// Compares on WHITESPACE-NORMALISED text specifically so the markdown file's own
// word-wrap line breaks (see the 2026-08-21 "slab\nconcrete" artifact, corrected by
// hand in the JSON) can never produce a false mismatch here -- normalisation erases
// layout only, never wording, variable numbering, or punctuation, so a real content
// difference still fails loudly.
function checkBodyDriftAgainstMarkdown(templates: ParsedTemplate[]): void {
  let md: string
  try {
    md = readFileSync(TEMPLATES_MD_PATH, 'utf8')
  } catch (e) {
    fail(`Could not read ${TEMPLATES_MD_PATH} for the content-drift check: ${(e as Error).message}`)
  }
  const sections = md.split(/\n(?=### )/)

  let anyMismatch = false
  for (const t of templates) {
    const section = sections.find((s) => {
      const h = s.match(/^### (\S+)\.\s+`([a-zA-Z0-9_]+)`/)
      return h != null && h[1] === t.id
    })
    if (!section) {
      // Should already have been caught by checkDriftAgainstMarkdown() -- fail
      // loudly here too rather than silently skipping, in case that check is
      // ever bypassed or called out of order.
      console.log(`FAIL  ${t.id} ${t.name} -- no matching markdown section found`)
      anyMismatch = true
      continue
    }
    const mdBody = extractCurrentMarkdownBody(section)
    if (mdBody === null) {
      console.log(`FAIL  ${t.id} ${t.name} -- could not extract a current body from the markdown section`)
      anyMismatch = true
      continue
    }
    if (normalizeBody(mdBody) !== normalizeBody(t.body)) {
      console.log(`FAIL  ${t.id} ${t.name} -- JSON body does not match markdown's current body (normalised)`)
      anyMismatch = true
    } else {
      console.log(`PASS  ${t.id} ${t.name}`)
    }
  }

  if (anyMismatch) {
    fail(
      "Content drift detected: one or more templates in docs/whatsapp-templates.json no longer " +
        "match docs/whatsapp-templates.md's current body. Update the JSON by hand to match the " +
        'markdown, then re-run.'
    )
  }
}

// KNOWN FALSE-POSITIVE, RECORDED NOT FIXED (2026-08-31, found reading this
// run's own dry-run output) -- the HX-pattern match below cannot distinguish
// "a live submission exists" from "an HX SID is merely MENTIONED somewhere in
// this row's prose." Template 13 (quoco_login_otp) is the live case: its
// Notes cell documents an orphaned Content resource (HXff09a18d...) that was
// created 2026-08-22, failed its ApprovalRequests call (wrong content type
// for AUTHENTICATION), and was DELETED the same day (204, confirmed 404 on a
// follow-up GET) -- never actually submitted to Meta. The regex below still
// matches that dead SID inside the explanatory prose and marks 13 as
// "already submitted," permanently, for the wrong reason. HARMLESS TODAY --
// 13 should not be resubmitted until its whatsapp/authentication shape is
// redesigned anyway (see the status doc's own row for that) -- but this will
// have to be noticed and manually worked around the day 13 IS actually
// ready, rather than the skip simply not firing.
//
// THE FIX, ARGUED, NOT BUILT: key this off the STATUS CELL (cells[6]) --
// this file's own `## Status legend` already defines exactly what belongs
// there (`not submitted` / `pending` / `approved` / `rejected`, though
// `received` is also in live use and undocumented in that legend -- a
// second, smaller drift worth folding into the same fix) -- rather than
// pattern-matching an HX SID anywhere across cells[5]/cells[7]'s free-form
// prose. A row is "already submitted" iff its Status cell does NOT start
// with "not submitted" -- structured-field equality, not a regex over
// prose. This is the same lesson this file's own header already states for
// markdown BODY parsing (three real failures, the third one silent and
// wrong) applied one field over: a free-text scan can always find a
// plausible-looking match for the wrong reason, and the fix each time is
// to trust the structured field that already carries the fact, not to
// pattern-match around it. Not implemented here, per direct instruction --
// this comment is the record for whoever next touches this function.
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
  if (t.button) {
    types['twilio/call-to-action'] = {
      body: t.body,
      actions: [{ type: 'URL', title: t.button.label, url: t.button.url }],
    }
    // Kept in the SAME flat `variables` map as the body's own -- unverified
    // against a real Twilio response, see the file-header VERIFY note.
    variables[t.button.sampleVar] = t.button.sampleValue
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

  const allTemplates = loadTemplatesFromJson()
  checkDriftAgainstMarkdown(allTemplates)
  checkBodyDriftAgainstMarkdown(allTemplates)

  const eligible = allTemplates.filter((t) => {
    if (HARD_EXCLUDED_NAMES.has(t.name)) {
      console.log(`SKIP (hard-excluded in code): ${t.id} ${t.name}`)
      return false
    }
    return true
  })

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
