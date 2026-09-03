// Beta provisioning operator script -- 034_owner_email_delivery.sql §2j/A1's
// exact three numbered steps, built here for the first time:
//   1. INSERT a `users` row: role='owner', auth_id=NULL, notification_email
//      set, notification_email_verified_at left NULL.
//   2. UPDATE projects SET owner_user_id = <the new row's id>.
//   3. Trigger the confirmation send: generate a token, hash it, store the
//      hash, email the raw token as a confirmation link.
// Run: npx tsx scripts/provision-beta-owner.ts <project_id> <full_name> <notification_email>
//
// app/api/owner/confirm-email (034 §5) is live -- merged and deployed
// 2026-09-03, same day as this file's own first real run. If step 3
// alone ever needs re-running for an EXISTING owner (a lost raw token,
// a bounced send, anything short of re-running steps 1/2) --
// scripts/resend-owner-confirmation.ts is that recovery path; it takes
// project_id, refuses if owner_user_id isn't already set, and does
// nothing else this file does.
//
// PRECONDITIONS CHECKED FIRST, BEFORE ANY WRITE (fixed 2026-09-03, real
// incident, not a hypothetical). The ORIGINAL order checked
// RESEND_API_KEY/RESEND_FROM_EMAIL/NEXT_PUBLIC_APP_URL only right before
// they were used, in step 3b -- AFTER the users row and the
// projects.owner_user_id UPDATE had already committed. The first real
// run hit exactly this: Vercel Production had the Resend credentials set,
// but the local .env.local this script actually reads did not, so
// sendEmail's own readCredentials() threw only after both writes had
// already gone through -- leaving a half-provisioned owner (a real row,
// a real project association, but no email ever sent and, worse, a
// verification token already minted and stored with its raw value alive
// only in that one now-dead process's memory, unrecoverable). This is
// exactly why scripts/resend-owner-confirmation.ts had to be built. Now
// fixed at the source: readCredentials() and the NEXT_PUBLIC_APP_URL
// check both run before any database read or write, so a missing
// credential fails the script before it creates anything, not halfway
// through. Safe to reorder -- both checks are pure environment reads with
// no dependency on the project/owner data resolved afterward.
//
// THE CRITICAL CONSTRAINT, STRUCTURAL, NOT A STYLE PREFERENCE: an owner row
// created by this script MUST have auth_id = NULL. get_user_tenant_id() --
// `SELECT tenant_id FROM users WHERE auth_id = auth.uid()`, a bare scalar
// SQL function with no LIMIT 1 -- is called by EVERY RLS policy in this
// project (CLAUDE.md §4). A second `users` row sharing an EXISTING auth_id
// (e.g. provisioning an owner who is also an existing admin/pm, by reusing
// their auth identity instead of creating a fresh row) makes that query
// return more than one row the moment both rows share a tenant, and
// Postgres raises "more than one row returned by a subquery used as an
// expression" on every RLS-gated query that admin's OWN session makes
// afterward -- a live outage for an unrelated user, not a provisioning
// error. This script has no flag, parameter, or code path that accepts an
// auth_id for the new row; NEW_OWNER_AUTH_ID below is hardcoded, and the
// assertion immediately before the INSERT exists so that if a future edit
// ever tries to parameterise it, the script refuses loudly instead of
// shipping the outage silently. Confirmed live against production
// (2026-09-03): `get_user_tenant_id()`'s definition is exactly this bare
// scalar select, unchanged, on both test-db and prod.
//
// NOT SET HERE, DELIBERATELY (034 §2j/A2): notification_email_verified_at.
// "Set ONLY by the recipient clicking through the confirmation link --
// never by the seeding step, never by the operator, never by any INSERT."
// A manually-typed address is not a verified one; the double opt-in gate
// this migration built stays load-bearing even for an address an operator
// entered by hand.
//
// TOKEN GENERATION, PER 034's OWN §3 COMMENT: the raw token is generated
// in application code (`crypto.randomBytes(32).toString('hex')`) -- not in
// SQL, since Postgres has no cryptographically strong random-string
// primitive without pgcrypto, which this project does not use anywhere
// else. Only SHA-256(raw token) is ever written to `owner_email_verifications
// .token_hash` -- the raw token exists only in the confirmation email
// itself. Expiry: `now() + 7 days`, 034's own recommended value.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { randomBytes, createHash } from 'crypto'
import { createServiceClient } from '../lib/supabase/service'
import { sendEmail, readCredentials } from '../lib/email/send'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days -- 034's own recommendation

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function main() {
  const [projectId, fullName, notificationEmail] = process.argv.slice(2)
  if (!projectId || !fullName || !notificationEmail) {
    console.error('Usage: npx tsx scripts/provision-beta-owner.ts <project_id> <full_name> <notification_email>')
    process.exit(1)
  }

  // Preconditions FIRST, before any database read or write -- see this
  // file's own header for the incident that made this ordering matter.
  readCredentials()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('provision-beta-owner: NEXT_PUBLIC_APP_URL must be set to build the confirmation link.')
  }

  const client = createServiceClient()

  // Step 1 (part a) -- resolve the target project's tenant. 034 §2j/A1
  // step 1 requires tenant_id to be "read from projects.tenant_id for the
  // project being provisioned," not passed separately -- a mismatched
  // tenant_id would fail the users.tenant_id / projects.tenant_id FK chain
  // anyway, but resolving it here means that failure can never happen.
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, tenant_id, owner_user_id, name')
    .eq('id', projectId)
    .single()
  if (projectError) throw projectError

  // Refuse to silently overwrite an existing owner. This script provisions
  // a FIRST owner; replacing one is a different operation with a different
  // consequence (the prior owner stops receiving reports, silently, unless
  // someone is specifically watching delivery_status for it) and needs its
  // own explicit decision, not an accidental second run of this script.
  if (project.owner_user_id) {
    throw new Error(
      `provision-beta-owner: project ${projectId} already has owner_user_id=${project.owner_user_id} set. ` +
        "This script only provisions a project's FIRST owner. Overwriting an existing " +
        'owner_user_id is a separate, deliberate operation -- not run here.',
    )
  }

  // Step 1 (part b) -- INSERT the users row.
  const NEW_OWNER_AUTH_ID: string | null = null
  if (NEW_OWNER_AUTH_ID !== null) {
    // See this file's own header for the full reasoning -- this branch
    // must never be reachable through normal execution.
    throw new Error(
      'provision-beta-owner: refusing to insert a users row with a non-null auth_id. ' +
        'A second row sharing an existing auth_id breaks get_user_tenant_id() (SELECT ' +
        'tenant_id FROM users WHERE auth_id = auth.uid(), a bare scalar with no LIMIT 1, ' +
        'called by every RLS policy in this project) the instant both rows share a ' +
        "tenant -- Postgres raises a runtime error on every RLS-gated query that auth " +
        "identity's own session makes afterward. An owner row must always have " +
        'auth_id = NULL (CLAUDE.md §5); this script has no code path for anything else.',
    )
  }

  const { data: owner, error: insertError } = await client
    .from('users')
    .insert({
      tenant_id: project.tenant_id,
      full_name: fullName,
      role: 'owner',
      auth_id: NEW_OWNER_AUTH_ID,
      whatsapp_number: null,
      status: 'active',
      notification_email: notificationEmail,
      // notification_email_verified_at intentionally omitted -> defaults
      // to NULL. See this file's header, 034 §2j/A2.
    })
    .select('id')
    .single()
  if (insertError) throw insertError

  console.log(`Step 1: created users row ${owner.id} (role=owner, tenant=${project.tenant_id}).`)

  // Step 2 -- associate the project with its new owner. Per 034 §2j/A1's
  // own correction (round 5 external review, B2/S3): this is a
  // `projects.owner_user_id` UPDATE, never a `project_members` INSERT.
  const { error: updateError } = await client.from('projects').update({ owner_user_id: owner.id }).eq('id', projectId)
  if (updateError) throw updateError

  console.log(`Step 2: project ${projectId} (${project.name}) owner_user_id -> ${owner.id}.`)

  // Step 3 -- generate the token, store its hash, send the confirmation
  // email carrying the raw token as a link. If this step alone needs
  // re-running later for an EXISTING owner (a lost raw token, a bounced
  // send) without repeating steps 1/2, use
  // scripts/resend-owner-confirmation.ts -- not this file, which refuses
  // to run again once owner_user_id is already set.
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const { error: verificationError } = await client.from('owner_email_verifications').insert({
    tenant_id: project.tenant_id,
    user_id: owner.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })
  if (verificationError) throw verificationError

  console.log(`Step 3a: verification token stored, expires ${expiresAt}.`)

  // appUrl already checked at the top -- reused here, not re-read.
  // Confirm route is GET-renders/POST-consumes (034 §5) -- this is the
  // GET link; the route's own page carries the token into its POST form
  // from there.
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
    console.error(`Step 3b: confirmation email send FAILED -- status ${emailResult.status}, message: ${emailResult.errorMessage ?? '(none)'}`)
    console.error('Response shape:', emailResult.responseShape)
    process.exit(1)
  }

  console.log(`Step 3b: confirmation email sent, provider id ${emailResult.id}.`)
  console.log(`\nDone. Owner ${owner.id} provisioned, UNVERIFIED. Nightly delivery stays gated (skipped_unverified) until the recipient clicks the confirmation link.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
