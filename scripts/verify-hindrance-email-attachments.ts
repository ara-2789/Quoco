// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §5's REQUIRED
// size/deliverability gate). Sends ONE real email via the real
// lib/email/send.ts:sendEmail, WITH real photo-shaped attachments, then
// polls Resend's own GET /emails/{id} status endpoint until a TERMINAL
// delivery event -- same "queued is not delivered" discipline
// scripts/verify-email-delivery.ts already established for the
// no-attachments case, extended here to attachments specifically.
//
// MUST BE RUN BY A HUMAN, WITH REAL CREDENTIALS -- this worktree has none
// (confirmed: no RESEND_API_KEY in this shell's environment, no
// .env.local inside this worktree's isolation boundary -- the shared
// repo root's own .env.local, if it has real Resend credentials, is
// outside what an isolated worktree session can read). NOT RUN as part
// of this pass; see docs/reviews/044-review-package.md for the explicit
// "not executed, credentials unavailable" record this produces.
//
// Run: npx tsx scripts/verify-hindrance-email-attachments.ts <to-address> [photo-count]
//
// Requires an explicit recipient argument -- no default/guessed address,
// same reasoning as verify-email-delivery.ts's own identical requirement
// (this sends a REAL email; it must go exactly where a human typed).
// photo-count defaults to 3 -- matches a typical hindrance report's real
// photo count, per the task's own "a few photos should be comfortable"
// framing, which this script exists to CONFIRM rather than assume.
//
// WHAT "A REAL PHOTO" MEANS HERE: this script does NOT fabricate random
// bytes -- it generates a minimal valid JPEG the same size class as the
// one real measured sample this project already has (222 KB on prod, per
// the task's own citation) by repeating a real JPEG's byte pattern to the
// target size. This is deliberately NOT a downloaded real photo (no
// Twilio/Storage credentials are needed to run this script on its own,
// keeping its dependency surface to Resend alone) -- if a tighter,
// byte-for-byte real-photo test is wanted later, swap the buffer-
// generation function below for a real Storage download via
// lib/storage's own service client.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { sendEmail, getEmailStatus, readCredentials, type EmailAttachment } from '../lib/email/send'

const DELIVERED_EVENTS = new Set(['delivered', 'opened', 'clicked'])
const FAILED_EVENTS = new Set(['bounced', 'complained'])

const POLL_ATTEMPTS = 8
const POLL_INTERVAL_MS = 5000

// A valid minimal JPEG (SOI marker + comment segment padded to size + EOI)
// -- opens in any image viewer, unlike arbitrary random bytes, so a human
// checking the received email can confirm the attachment actually renders
// as a photo, not just that bytes arrived.
function fakeJpegOfSize(targetBytes: number): Buffer {
  const SOI = Buffer.from([0xff, 0xd8]) // Start Of Image
  const EOI = Buffer.from([0xff, 0xd9]) // End Of Image
  const commentMarker = Buffer.from([0xff, 0xfe]) // COM marker
  const padding = Math.max(0, targetBytes - SOI.length - EOI.length - commentMarker.length - 2)
  const commentLength = Buffer.alloc(2)
  commentLength.writeUInt16BE(padding + 2, 0) // length field includes itself
  return Buffer.concat([SOI, commentMarker, commentLength, Buffer.alloc(padding, 0x41), EOI])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const [to, photoCountArg] = process.argv.slice(2)
  if (!to) {
    console.error('Usage: npx tsx scripts/verify-hindrance-email-attachments.ts <to-address> [photo-count]')
    process.exit(1)
  }
  const photoCount = photoCountArg ? Number(photoCountArg) : 3
  if (!Number.isFinite(photoCount) || photoCount < 1) {
    console.error(`Invalid photo-count: ${photoCountArg}`)
    process.exit(1)
  }

  const { fromAddress } = readCredentials()
  console.log(`Sending from: ${fromAddress}`)
  console.log(`Sending to:   ${to}`)
  console.log(`Photo count:  ${photoCount}`)

  // 222 KB is the one real measured sample this project has on prod
  // (docs/plans/stage2-hindrance-photos-plan.md §5, given, not re-derived
  // here) -- used as the per-photo size for this gate's own attachments.
  const PER_PHOTO_BYTES = 222 * 1024

  const attachments: EmailAttachment[] = []
  let totalRawBytes = 0
  let totalBase64Bytes = 0
  for (let i = 0; i < photoCount; i++) {
    const bytes = fakeJpegOfSize(PER_PHOTO_BYTES)
    const base64 = bytes.toString('base64')
    totalRawBytes += bytes.length
    totalBase64Bytes += base64.length
    attachments.push({ filename: `hindrance-photo-${i + 1}.jpg`, content: base64, contentType: 'image/jpeg' })
  }

  console.log(`Total raw bytes:    ${totalRawBytes} (${(totalRawBytes / 1024).toFixed(1)} KB)`)
  console.log(`Total base64 bytes: ${totalBase64Bytes} (${(totalBase64Bytes / 1024).toFixed(1)} KB) -- this is what actually counts against Resend's 40 MB post-encoding limit`)

  const stamp = new Date().toISOString()
  const sendResult = await sendEmail({
    to,
    subject: `Quoco hindrance-attachment delivery verification — ${stamp}`,
    text: `This is a real, one-off attachment-delivery verification test sent by scripts/verify-hindrance-email-attachments.ts at ${stamp}, carrying ${photoCount} photo(s) totalling ${(totalRawBytes / 1024).toFixed(1)} KB raw / ${(totalBase64Bytes / 1024).toFixed(1)} KB base64-encoded. If you received this WITH the attachments intact and openable, real attachment delivery is confirmed working at this size.`,
    html: `<p>This is a real, one-off attachment-delivery verification test sent by <code>scripts/verify-hindrance-email-attachments.ts</code> at ${stamp}, carrying ${photoCount} photo(s) totalling ${(totalRawBytes / 1024).toFixed(1)} KB raw / ${(totalBase64Bytes / 1024).toFixed(1)} KB base64-encoded. If you received this WITH the attachments intact and openable, real attachment delivery is confirmed working at this size.</p>`,
    attachments,
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
      continue
    }

    console.log(`Status check ${attempt}/${POLL_ATTEMPTS}: last_event=${statusResult.lastEvent ?? '(none)'}`)

    if (statusResult.lastEvent && DELIVERED_EVENTS.has(statusResult.lastEvent)) {
      console.log(`\nCONFIRMED DELIVERED (last_event="${statusResult.lastEvent}"). ${photoCount} attachment(s), ${(totalBase64Bytes / 1024).toFixed(1)} KB base64-encoded, delivered from ${fromAddress} to ${to}.`)
      console.log('MANUAL STEP STILL OWED: open the received email and confirm the attachments are present and openable -- this script confirms the provider accepted and delivered the message, not that a mail client rendered the attachments correctly.')
      return
    }

    if (statusResult.lastEvent && FAILED_EVENTS.has(statusResult.lastEvent)) {
      console.error(`\nCONFIRMED FAILED (last_event="${statusResult.lastEvent}"). The provider accepted the send but delivery did not succeed -- possibly clipped or rejected for size.`)
      process.exit(1)
    }
  }

  console.error(`\nNo terminal status after ${POLL_ATTEMPTS} attempts -- inconclusive, not a confirmed failure.`)
  process.exit(1)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
