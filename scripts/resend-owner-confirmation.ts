// Recovers from a specific, real failure (2026-09-03): scripts/provision-
// beta-owner.ts's FIRST real run stored a verification token
// (owner_email_verifications) and then attempted to send the confirmation
// email -- but RESEND_API_KEY/RESEND_FROM_EMAIL were set in Vercel
// Production and NOT in the local .env.local the script actually read, so
// sendEmail's own readCredentials() threw. By that point the token was
// already committed to the database, but its raw value existed only in
// that one process's memory, in a local variable -- never logged (no
// console.log/console.error in that script ever printed it), never
// transmitted (readCredentials() throws before any HTTP request is ever
// made). SHA-256 is one-way: the stored token_hash cannot be turned back
// into a value the confirm route would ever match. The row is permanently
// dead.
//
// THE FIX, PER 034's OWN ESTABLISHED PRECEDENT: 034's EXPIRED-TOKEN
// BEHAVIOUR note already specifies this exact recovery shape for the
// analogous case ("the operator re-triggers the confirmation script,
// which mints a NEW token/row rather than reusing or extending the
// expired one -- an expired token is dead, never revived"). An
// undeliverable token is functionally identical to an expired one for
// this purpose. This script mints a fresh token/row and sends it; the
// dead row from the failed run is left alone, not touched -- it is
// provably inert (nobody has ever possessed its raw value, so it can
// never be validly used) and will simply expire on its own schedule.
// `owner_email_verifications.user_id` carries no uniqueness constraint
// (only `token_hash` does), so a second row for the same owner is already
// schema-legal, and the confirm route only ever looks up ONE row by
// `token_hash` -- two valid-but-unused rows for one owner cause zero
// functional ambiguity.
//
// provision-beta-owner.ts's own ordering is fixed, same session
// (credentials/app-URL now checked before any write) -- this exact
// failure shouldn't recur for a FIRST provisioning. This script stays
// necessary for any case where a stored token's raw value is separately
// lost after the fact (this exact incident; a bounced email whose token
// hasn't expired yet and a fresh send is wanted instead).
//
// Run: npx tsx scripts/resend-owner-confirmation.ts <project_id>
//
// TAKES project_id, NOT a user id -- resolves owner_user_id from
// projects itself, the same way provision-beta-owner.ts's own step 2
// does. Deliberate: a script accepting a user_id directly could be
// pointed at ANY users row, not necessarily one a real project actually
// recognises as its own owner.
//
// NEVER PRINTS THE RAW TOKEN OR THE CONFIRMATION URL, ANYWHERE. The
// entire point of double opt-in is that the link travels by email, to
// the address being verified -- a script that echoes it to a terminal
// puts it in shell history, in any terminal-recording tool, in front of
// anyone looking over the operator's shoulder, defeating that exactly as
// thoroughly as a compromised mail gateway would. Checked before
// considering this file done: every console.log/console.error call
// below is grepped by hand against `rawToken`/`confirmUrl` -- neither
// name appears in any of them.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { randomBytes, createHash } from 'crypto'
import { createServiceClient } from '../lib/supabase/service'
import { sendEmail, readCredentials } from '../lib/email/send'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days -- 034's own recommendation, same as provision-beta-owner.ts

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function main() {
  const [projectId] = process.argv.slice(2)
  if (!projectId) {
    console.error('Usage: npx tsx scripts/resend-owner-confirmation.ts <project_id>')
    process.exit(1)
  }

  // Preconditions FIRST, before any database read or write -- the exact
  // ordering defect this script exists to recover from, not repeated
  // here. See this file's own header, and provision-beta-owner.ts's
  // matching fix, same session.
  readCredentials()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('resend-owner-confirmation: NEXT_PUBLIC_APP_URL must be set to build the confirmation link.')
  }

  const client = createServiceClient()

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, tenant_id, owner_user_id, name')
    .eq('id', projectId)
    .single()
  if (projectError) throw projectError

  // Resolves owner_user_id from the project -- never takes a user id as
  // input, per this file's own header. Refuses outright if no owner
  // exists yet: that is provision-beta-owner.ts's job, not this one's.
  if (!project.owner_user_id) {
    throw new Error(
      `resend-owner-confirmation: project ${projectId} has no owner_user_id set. ` +
        'Run scripts/provision-beta-owner.ts first -- this script only re-sends a ' +
        'confirmation for an owner who already exists.',
    )
  }

  const { data: owner, error: ownerError } = await client
    .from('users')
    .select('full_name, notification_email')
    .eq('id', project.owner_user_id)
    .single()
  if (ownerError) throw ownerError

  const notificationEmail = owner.notification_email as string | null
  if (!notificationEmail) {
    throw new Error(`resend-owner-confirmation: owner ${project.owner_user_id} has no notification_email set.`)
  }
  const fullName = (owner.full_name as string | null) ?? 'there'

  // Step 3a only -- mint a FRESH token/row. The dead row from the failed
  // run (if any) is deliberately left untouched; see this file's header
  // for why that is safe and matches 034's own precedent.
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const { error: verificationError } = await client.from('owner_email_verifications').insert({
    tenant_id: project.tenant_id,
    user_id: project.owner_user_id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })
  if (verificationError) throw verificationError

  console.log(`Verification token stored for owner ${project.owner_user_id}, expires ${expiresAt}.`)

  // Step 3b -- send. Confirm route is GET-renders/POST-consumes (034 §5);
  // this is the GET link, same shape as provision-beta-owner.ts's own.
  const confirmUrl = `${appUrl}/api/owner/confirm-email?token=${rawToken}`

  const emailResult = await sendEmail({
    to: notificationEmail,
    subject: 'Confirm your email to receive Quoco daily reports',
    text: [
      `Hi ${fullName},`,
      '',
      `You've been added as the report recipient for ${project.name} on Quoco.`,
      '',
      'Confirm your email address to start receiving daily progress reports:',
      confirmUrl,
      '',
      'This link expires in 7 days.',
      '',
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(fullName)},</p>`,
      `<p>You've been added as the report recipient for <strong>${escapeHtml(project.name)}</strong> on Quoco.</p>`,
      '<p>Confirm your email address to start receiving daily progress reports:</p>',
      `<p><a href="${confirmUrl}">${confirmUrl}</a></p>`,
      '<p>This link expires in 7 days.</p>',
      "<p>If you weren't expecting this, you can ignore this email.</p>",
    ].join(''),
  })

  if (!emailResult.ok) {
    console.error(`Confirmation email send FAILED -- status ${emailResult.status}, message: ${emailResult.errorMessage ?? '(none)'}`)
    console.error('Response shape:', emailResult.responseShape)
    process.exit(1)
  }

  console.log(`Confirmation email sent, provider id ${emailResult.id}.`)
  console.log(`\nDone. A fresh confirmation link was sent to the owner's inbox. It expires ${expiresAt}. Neither the token nor the link is ever printed -- check the inbox.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
