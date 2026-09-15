// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §5's REQUIRED
// size/deliverability gate). Sends ONE real email via the real
// lib/email/send.ts:sendEmail, WITH real photo-shaped attachments, then
// polls Resend's own GET /emails/{id} status endpoint until a TERMINAL
// delivery event -- same "queued is not delivered" discipline
// scripts/verify-email-delivery.ts already established for the
// no-attachments case, extended here to attachments specifically.
//
// FIRST REAL EXECUTION FAILED, 2026-09-14 -- recorded here, not erased.
// This script was written and recorded in docs/reviews/044-review-package.md
// as "ready-to-run" without ever having been executed. Its first real run
// (a --dry-run invocation, no send) crashed immediately:
//   RangeError [ERR_OUT_OF_RANGE]: value must be >= 0 and <= 65535. Received 227322
//     at Buffer.writeUInt16BE, at fakeJpegOfSize
// Root cause: a JPEG segment's length field is a 16-bit big-endian integer
// (max 65535, and it counts itself, so max real payload is 65533) --
// fakeJpegOfSize's original version tried to write a single COM segment
// sized for an entire 222 KB (227,328-byte) photo directly into that
// field. Never having been executed is exactly why this went unnoticed --
// same class of gap as a test that only passes because of a hand-added
// local env value nobody re-derives. Fixed below by chaining multiple
// bounded COM segments, each within the 16-bit limit, instead of one
// oversized one. See fakeJpegOfSize's own comment for the fix and its
// honest limits.
//
// DRY-RUN MODE, ADDED THE SAME PASS. `--dry-run` generates every
// attachment buffer, prints each one's size and the total encoded
// payload, and exits BEFORE reading Resend credentials or calling
// sendEmail -- this is how the fix above was proven correct without
// sending anything (see docs/reviews/044-review-package.md for the pasted
// output of an actual `--dry-run` run). The real send remains Aravind's
// to run, with a real, already-confirmed recipient address.
//
// STILL MUST BE RUN FOR REAL BY A HUMAN, WITH REAL CREDENTIALS -- this
// worktree has none (confirmed: no RESEND_API_KEY in this shell's
// environment, no .env.local inside this worktree's isolation boundary).
// The REAL send (non-dry-run) has still never been executed as of this
// commit -- only the dry-run generator has been proven. Do not conflate
// "the generator works" with "a real send/deliverability gate has passed."
//
// Run (dry, no credentials needed, no network call):
//   npx tsx scripts/verify-hindrance-email-attachments.ts --dry-run [photo-count]
// Run (real, sends an actual email -- needs RESEND_API_KEY/RESEND_FROM_EMAIL):
//   npx tsx scripts/verify-hindrance-email-attachments.ts <to-address> [photo-count]
//
// Requires an explicit recipient argument for a real send -- no
// default/guessed address, same reasoning as verify-email-delivery.ts's
// own identical requirement (this sends a REAL email; it must go exactly
// where a human typed). photo-count defaults to 3 -- matches a typical
// hindrance report's real photo count, per the task's own "a few photos
// should be comfortable" framing, which this script exists to CONFIRM
// rather than assume.
//
// WHAT "A REAL PHOTO" MEANS HERE, CORRECTED: this script does NOT
// fabricate random bytes, and does NOT claim the result "opens in any
// image viewer" (the original version asserted this without ever running
// -- an unverified claim of the same kind this whole incident is about,
// retracted here rather than repeated). What fakeJpegOfSize actually
// produces is a SYNTACTICALLY VALID JPEG BYTE STREAM -- correct SOI/EOI
// markers, and one or more COM (comment) segments whose 16-bit length
// fields are always in range -- at an EXACT target size. It carries NO
// real image data (no SOF/DQT/DHT/SOS frame or scan bytes), so it is NOT
// guaranteed to render as a visible picture in a mail client's inline
// preview. This script exists to test SIZE and DELIVERABILITY (does the
// provider accept and deliver an email this large, with this many
// attachments), not visual rendering -- a human checking a real sent
// email should confirm the attachment is present and downloads without
// corruption, not that it displays as a photo.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { sendEmail, getEmailStatus, readCredentials, type EmailAttachment } from '../lib/email/send'

const DELIVERED_EVENTS = new Set(['delivered', 'opened', 'clicked'])
const FAILED_EVENTS = new Set(['bounced', 'complained'])

const POLL_ATTEMPTS = 8
const POLL_INTERVAL_MS = 5000

// A JPEG segment's length field (the 2 bytes immediately after a marker
// like 0xFF 0xFE) is a 16-bit big-endian unsigned integer, and it counts
// ITSELF -- so the real maximum payload a single segment can carry is
// 65535 - 2 = 65533 bytes. MAX_SEGMENT_PAYLOAD is kept well under that
// (65000, not 65533) deliberately, so the tail-adjustment step below
// always has headroom to grow the LAST segment by a few extra bytes
// without ever risking pushing its own length field out of range.
const MAX_SEGMENT_PAYLOAD = 65000
// Marker (2 bytes) + length field (2 bytes) + zero payload -- the
// smallest a well-formed COM segment can be.
const MIN_SEGMENT_WIRE = 4

function comSegment(payloadLen: number): Buffer {
  const lengthValue = payloadLen + 2 // the length field counts itself, not the marker
  const header = Buffer.alloc(4)
  header.writeUInt8(0xff, 0)
  header.writeUInt8(0xfe, 1)
  header.writeUInt16BE(lengthValue, 2)
  return Buffer.concat([header, Buffer.alloc(payloadLen, 0x41)])
}

/**
 * Produce a syntactically valid JPEG byte stream (SOI, one or more COM
 * segments, EOI) of EXACTLY targetBytes -- see this file's own header for
 * what "valid" does and does not mean here (a real byte structure, not a
 * decodable photo). Fixes the original single-oversized-segment version's
 * 16-bit overflow by chaining as many MAX_SEGMENT_PAYLOAD-sized segments
 * as needed, then folding any remainder into the last one.
 */
function fakeJpegOfSize(targetBytes: number): Buffer {
  const SOI = Buffer.from([0xff, 0xd8])
  const EOI = Buffer.from([0xff, 0xd9])
  const overhead = SOI.length + EOI.length

  if (targetBytes < overhead) {
    throw new Error(`fakeJpegOfSize: targetBytes (${targetBytes}) is smaller than an empty JPEG's own overhead (${overhead} bytes: SOI+EOI)`)
  }

  let remaining = targetBytes - overhead
  const payloadLens: number[] = []

  while (remaining >= MIN_SEGMENT_WIRE) {
    const wireCost = Math.min(remaining, MAX_SEGMENT_PAYLOAD + MIN_SEGMENT_WIRE)
    payloadLens.push(wireCost - MIN_SEGMENT_WIRE)
    remaining -= wireCost
  }

  if (remaining > 0) {
    if (payloadLens.length === 0) {
      throw new Error(
        `fakeJpegOfSize: targetBytes (${targetBytes}) leaves ${remaining} byte(s) after SOI+EOI overhead -- ` +
          `too small to form even one minimal COM segment (needs ${MIN_SEGMENT_WIRE} more). ` +
          `Pick a target of at least ${targetBytes - remaining + MIN_SEGMENT_WIRE} bytes.`,
      )
    }
    // Fold the leftover (always < MIN_SEGMENT_WIRE = 4 bytes) into the
    // last segment -- safe by construction, since MAX_SEGMENT_PAYLOAD
    // (65000) leaves 533 bytes of headroom under the real 65533 ceiling.
    payloadLens[payloadLens.length - 1] += remaining
  }

  const segments = payloadLens.map(comSegment)
  const result = Buffer.concat([SOI, ...segments, EOI])
  if (result.length !== targetBytes) {
    // Defensive -- should be unreachable given the arithmetic above, but
    // a silent off-by-N here would defeat the entire point of this
    // function (an exact-size test fixture). Fail loudly instead.
    throw new Error(`fakeJpegOfSize: internal error -- built ${result.length} bytes, expected exactly ${targetBytes}`)
  }
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const dryRun = rawArgs.includes('--dry-run')
  const positional = rawArgs.filter((a) => !a.startsWith('--'))
  // In --dry-run mode there is no <to-address> positional at all -- the
  // one remaining positional (if any) is the photo-count. Without this
  // branch, `[to, photoCountArg] = positional` for `--dry-run 10` would
  // bind photoCountArg's slot to `undefined` (only one positional exists)
  // and silently ignore the requested count -- caught by actually running
  // `--dry-run 1` and `--dry-run 10` side by side and seeing both print
  // "Photo count: 3" (the default), not by inspection.
  const [to, photoCountArg] = dryRun ? [undefined, positional[0]] : positional

  if (!dryRun && !to) {
    console.error('Usage:')
    console.error('  Dry run (no send, no credentials needed): npx tsx scripts/verify-hindrance-email-attachments.ts --dry-run [photo-count]')
    console.error('  Real send:                                npx tsx scripts/verify-hindrance-email-attachments.ts <to-address> [photo-count]')
    process.exit(1)
  }
  const photoCount = photoCountArg ? Number(photoCountArg) : 3
  if (!Number.isFinite(photoCount) || photoCount < 1) {
    console.error(`Invalid photo-count: ${photoCountArg}`)
    process.exit(1)
  }

  console.log(`Mode:         ${dryRun ? 'DRY RUN -- no send, no credentials read' : 'REAL SEND'}`)
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
    console.log(`  Attachment ${i + 1}: hindrance-photo-${i + 1}.jpg -- ${bytes.length} raw bytes (${(bytes.length / 1024).toFixed(1)} KB), ${base64.length} base64 bytes (${(base64.length / 1024).toFixed(1)} KB)`)
    attachments.push({ filename: `hindrance-photo-${i + 1}.jpg`, content: base64, contentType: 'image/jpeg' })
  }

  console.log(`Total raw bytes:    ${totalRawBytes} (${(totalRawBytes / 1024).toFixed(1)} KB)`)
  console.log(`Total base64 bytes: ${totalBase64Bytes} (${(totalBase64Bytes / 1024).toFixed(1)} KB) -- this is what actually counts against Resend's 40 MB post-encoding limit`)

  if (dryRun) {
    console.log('\nDRY RUN complete -- exiting before reading any credentials or calling Resend. No email was sent.')
    return
  }

  const { fromAddress } = readCredentials()
  console.log(`Sending from: ${fromAddress}`)
  console.log(`Sending to:   ${to}`)

  const stamp = new Date().toISOString()
  const sendResult = await sendEmail({
    to: to!,
    subject: `Quoco hindrance-attachment delivery verification — ${stamp}`,
    text: `This is a real, one-off attachment-delivery verification test sent by scripts/verify-hindrance-email-attachments.ts at ${stamp}, carrying ${photoCount} photo(s) totalling ${(totalRawBytes / 1024).toFixed(1)} KB raw / ${(totalBase64Bytes / 1024).toFixed(1)} KB base64-encoded. These attachments carry NO real image data (see the script's own header) -- confirm they are present and download without corruption, not that they display as a picture.`,
    html: `<p>This is a real, one-off attachment-delivery verification test sent by <code>scripts/verify-hindrance-email-attachments.ts</code> at ${stamp}, carrying ${photoCount} photo(s) totalling ${(totalRawBytes / 1024).toFixed(1)} KB raw / ${(totalBase64Bytes / 1024).toFixed(1)} KB base64-encoded. These attachments carry NO real image data (see the script's own header) -- confirm they are present and download without corruption, not that they display as a picture.</p>`,
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
      console.log('MANUAL STEP STILL OWED: open the received email and confirm the attachments are present and downloadable without corruption -- these attachments carry no real image data (this file\'s own header), so a viewer showing a broken-image icon is expected and not itself a failure signal; a missing or 0-byte/corrupted attachment is.')
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
