// Ad-hoc menu PR 2, step 5, Phase A -- "the first question is whether the
// email actually reaches a human" (Aravind, 2026-09-06). Sends ONE real
// email via the real lib/email/send.ts:sendEmail, then polls Resend's own
// GET /emails/{id} status endpoint (lib/email/send.ts:getEmailStatus)
// until it reports a TERMINAL delivery event -- never reports "sent" as
// "delivered". Same "queued is not delivered" discipline this project
// already applies to WhatsApp sends (CLAUDE.md), extended to email.
//
// MUST BE RUN BY A HUMAN, WITH REAL CREDENTIALS -- this sandbox has none
// (confirmed: no RESEND_API_KEY in this shell, no .env.local/.env present).
// Populate .env.local first (e.g. `vercel env pull .env.local` against
// Production, once RESEND_FROM_EMAIL is actually set to the verified
// quoco.co.in sender there -- see this session's own Resend correction).
//
// Run: npx tsx scripts/verify-email-delivery.ts <to-address>
//
// Requires an explicit recipient argument -- no default/guessed address.
// Same reasoning as the "never send WhatsApp to an unconfirmed number"
// standing rule, one channel over: this script sends a REAL email: it must
// go exactly where a human typed, never somewhere inferred.
//
// NOT VERIFIED AGAINST RESEND'S CURRENT DOCS FROM A LIVE CALL -- stated
// plainly, per CLAUDE.md's own "say so, don't guess" rule. getEmailStatus's
// parsing of `last_event` is this session's best understanding, unconfirmed
// live. This script prints the FULL raw status body on every poll so a
// human can catch a shape mismatch immediately, not trust a silently-wrong
// interpretation.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { sendEmail, getEmailStatus, readCredentials } from '../lib/email/send'

// Resend's own documented terminal/near-terminal events, best understanding
// (see this file's header) -- 'delivered'/'opened'/'clicked' count as a
// confirmed real delivery; 'bounced'/'complained' count as a confirmed
// real failure. Anything else ('sent', 'queued', 'delivery_delayed', or an
// unrecognised future value) is treated as still-pending and polled again
// -- fails toward "keep waiting," never toward a false positive.
const DELIVERED_EVENTS = new Set(['delivered', 'opened', 'clicked'])
const FAILED_EVENTS = new Set(['bounced', 'complained'])

const POLL_ATTEMPTS = 8
const POLL_INTERVAL_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const [to] = process.argv.slice(2)
  if (!to) {
    console.error('Usage: npx tsx scripts/verify-email-delivery.ts <to-address>')
    process.exit(1)
  }

  // Precondition first, before any network call -- same ordering fix this
  // session's own resend-owner-confirmation.ts already established.
  const { fromAddress } = readCredentials()
  console.log(`Sending from: ${fromAddress}`)
  console.log(`Sending to:   ${to}`)

  const stamp = new Date().toISOString()
  const sendResult = await sendEmail({
    to,
    subject: `Quoco delivery verification — ${stamp}`,
    text: `This is a real, one-off delivery-verification test sent by scripts/verify-email-delivery.ts at ${stamp}. If you received this, real email delivery from this sender is confirmed working.`,
    html: `<p>This is a real, one-off delivery-verification test sent by <code>scripts/verify-email-delivery.ts</code> at ${stamp}. If you received this, real email delivery from this sender is confirmed working.</p>`,
  })

  if (!sendResult.ok) {
    console.error(`SEND FAILED -- status ${sendResult.status}, message: ${sendResult.errorMessage ?? '(none)'}`)
    console.error('Response shape:', sendResult.responseShape)
    process.exit(1)
  }

  console.log(`Send accepted synchronously (provider id ${sendResult.id}). This is NOT delivery confirmation -- polling for the real outcome now.`)

  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    const statusResult = await getEmailStatus(sendResult.id)
    if (!statusResult.ok) {
      console.error(`Status check ${attempt}/${POLL_ATTEMPTS} FAILED -- status ${statusResult.status}, message: ${statusResult.errorMessage ?? '(none)'}`)
      console.error('Response shape:', statusResult.responseShape)
      continue
    }

    console.log(`Status check ${attempt}/${POLL_ATTEMPTS}: last_event=${statusResult.lastEvent ?? '(none)'}`)
    console.log('Raw provider response:', JSON.stringify(statusResult.raw, null, 2))

    if (statusResult.lastEvent && DELIVERED_EVENTS.has(statusResult.lastEvent)) {
      console.log(`\nCONFIRMED DELIVERED (last_event="${statusResult.lastEvent}"). Real email delivery from ${fromAddress} to ${to} is verified working.`)
      return
    }

    if (statusResult.lastEvent && FAILED_EVENTS.has(statusResult.lastEvent)) {
      console.error(`\nCONFIRMED FAILED (last_event="${statusResult.lastEvent}"). The provider accepted the send but delivery did not succeed.`)
      process.exit(1)
    }
  }

  console.error(
    `\nINCONCLUSIVE after ${POLL_ATTEMPTS} checks (~${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s): no terminal last_event observed. This does NOT mean delivery failed -- check the Resend dashboard directly for provider id ${sendResult.id}, and check the actual inbox at ${to}.`,
  )
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
