# Twilio production sender swap + supervised live run (JJ4 runbook)

**Status: WRITTEN, NOT EXECUTED, per direct instruction (JJ4). Both the sender swap
(HH2/II4) and the supervised live run below need their own go-ahead — this document
exists so the full sequence can run in one sitting once authorized, rather than being
reconstructed from a chat transcript at that point.**

**Depends on:** the II3 inbound-start-trigger build (`lib/whatsapp/inbound-start.ts`)
being merged and deployed — this is what makes Step 3 below ("message the number, get a
real reply") work at all. Before this build, an inbound to an idle engineer got silence
(CLAUDE.md's "BOT-07 SILENCE" entry); the live run below assumes that's fixed.

## 0. Preconditions — check, don't assume

- [ ] `docs/reviews/whatsapp-template-submission-status.md`'s three answered-on-attempt
      rows (pre-verification submission, display-name approval, messaging tier) have
      been filled in with real results from WhatsApp Manager. A rejected display name
      caps sends at 250 conversations/24h — fine for one supervised run, but worth
      knowing before, not discovering after.
- [ ] At least `quoco_morning_checkin` (template 1) is Meta-approved, OR the plan is to
      test only the REPLY path (this build) rather than a template-initiated send —
      the live run below is reply-only and does not require any template approval,
      since it starts from Aravind's own inbound message, not a business-initiated send.
- [ ] `CRON_SECRET` is provisioned in Vercel (§8) and a deploy has happened since — the
      II3 build's PR merge triggers a deploy; confirm that deploy is the one live before
      starting.

## 1. What actually changes on swap — traced, not assumed

Two, and only two, code paths read Twilio env vars:

- `app/api/whatsapp/webhook/route.ts:122` — `TWILIO_AUTH_TOKEN`, used to recompute the
  HMAC-SHA1 signature Twilio attaches to every inbound webhook call
  (`validateTwilioSignature`). **If the production WABA sender lives under a different
  Twilio Account (a different Account SID) than the sandbox, its Auth Token is also
  different** — swapping only the phone number while leaving the sandbox's Auth Token in
  place would make every real inbound fail signature validation (403), not silently
  degrade. Confirm which is true (same account, new number vs. genuinely new
  account/subaccount) before touching anything — Twilio Console → Account → General
  Settings shows the Auth Token for whichever account is currently active.
- `app/(dashboard)/daily-logs/page.tsx:69` — `TWILIO_WHATSAPP_NUMBER`, read for the
  DASH-03 reactivation CTA display only (formats and shows the number a blocked
  engineer should text START to). Purely cosmetic; a stale value here degrades one CTA,
  it does not affect message delivery.

`TWILIO_ACCOUNT_SID` is declared in CLAUDE.md's env var list but has zero readers in the
codebase today (grepped `app/`, `lib/` — no hits) — reserved for the future outbound-send
primitive (#69/031), not live yet. Setting it now is harmless but not load-bearing for
this swap.

## 2. Swap steps

1. In Vercel → Project → Settings → Environment Variables (Production):
   - `TWILIO_WHATSAPP_NUMBER` → the real WABA-approved sender, in Twilio's
     `whatsapp:+<E.164>` format (matching the existing sandbox value's shape,
     `whatsapp:+14155238886`).
   - `TWILIO_AUTH_TOKEN` → the Auth Token for whichever Twilio account now owns that
     sender (per §1 above — do not assume it's unchanged).
2. In Twilio Console → the WABA sender's own configuration (not the sandbox's) → set the
   inbound webhook URL to `https://<production-domain>/api/whatsapp/webhook`, HTTP POST
   — the exact same route, no code change; only the sandbox's separate webhook config
   pointed elsewhere before.
3. Trigger a new Vercel deploy (or confirm the env var change alone takes effect —
   Vercel env vars are read at request time for these two call sites, not build time, so
   a redeploy is not strictly required, but doing one removes any doubt).

## 3. Verify by BEHAVIOUR, not by reading the Vercel field

Per JJ4's own instruction — a value showing correctly in a dashboard field proves nothing
about what's actually wired (CLAUDE.md's own recorded lesson: Vercel Sensitive values
render blank in the dashboard regardless of content; more generally, a config screen is
not the thing itself). Verify each of these as an observed outcome:

- [ ] Send a plain WhatsApp message to the new production number from a phone that is
      NOT yet registered as an engineer. Expect: the BOT-08 `notRegisteredResponse()`
      text ("This number is not registered with Quoco..."). Getting ANY reply at all
      here — not silence, not a 403 in Vercel's function logs — proves signature
      validation is passing with the real Auth Token, which is the single most likely
      swap failure mode (§1).
  - If instead nothing arrives: check Vercel's function logs for a 403 on
    `/api/whatsapp/webhook` — that specific failure means the Auth Token doesn't match
    the account that actually signed the request. Fix and retry before proceeding.
- [ ] Register a real (or dedicated test) engineer against the new number, active
      status, real project membership.
- [ ] Message the number as that engineer. Expect: per this build (II3), a REAL reply —
      either the morning Q1 prompt, or `REPORT_READY_REPLY` if run after 19:45 IST — not
      silence. This is the first time this build's production behaviour and the real
      production sender are proven together, not separately.

Do not proceed to §4 until every box above is checked by direct observation.

## 4. The supervised live run

Once §3 passes, this is the actual product test: a complete, real, end-to-end check-in
by a human, through to delivery.

1. Aravind messages the production number from his own phone. No active session, no
   prior submission today → per this build, gets the morning Q1 prompt.
2. Complete the full morning flow (Q1-Q4) with real answers.
3. Wait for or manually trigger the point where the evening window opens (per
   `CHECKIN_CHECKPOINTS.eveningSend`, 18:30 IST) — or, per this build's own accepted
   early-volunteer case (`docs/inbound-start-trigger-plan.md` (a), row 3), message the
   number again any time after morning completes; evening starts immediately rather than
   waiting for 18:30.
4. Complete the full evening flow.
5. At 19:45 IST (`eveningClose`), confirm the DPR actually generates: a new `dprs` row
   for today, for Aravind's project/engineer, with real content (not
   `skipped_no_data` — there IS data this time). Check directly against the database,
   not the PM dashboard alone.
6. If the owner-delivery path (`dpr-24`, 20:30 IST `ownerSend`) is also live, confirm
   the email arrives. If it is not yet live, stop at step 5 and note that explicitly
   rather than treating an unsent owner email as a failure of this run.

**EXPECTED BEHAVIOUR, NOT A DEFECT (KK3) — the near-close window.** `routeInboundMessage`'s
refusal boundary is a single instant, 19:45 IST (`eveningClose`), and DPR generation
itself takes roughly 12 seconds. An inbound arriving just before the boundary — e.g.
18:44 into an evening flow not yet complete, or literally 19:44 — starts (or continues)
a flow that CANNOT finish before generation runs. The report that goes out at 19:45
honestly reflects what was true at that instant: an evening half genuinely not yet
received. This is not a bug in this build or in the generator — it is the correct
behaviour of a hard cutoff meeting a flow that takes longer than the time left before it.
The 19:45→20:30 PM edit window (`CHECKIN_CHECKPOINTS.ownerSend`) exists specifically to
correct exactly this kind of near-miss before the owner ever sees it. **If the live run
above lands near 19:45 and the resulting report reads "evening check-in not received"
for data that finished arriving a minute or two later: this is the expected shape, not a
failure to diagnose.** Recognise it, use the PM edit window to correct the record, and do
not spend time chasing it as a code defect.

## 5. Rollback

If §3 fails and the cause isn't quickly fixable: revert `TWILIO_WHATSAPP_NUMBER` and
`TWILIO_AUTH_TOKEN` in Vercel to the sandbox's original values (recorded before the swap
— capture them BEFORE step 2.1 above, not after something breaks). The sandbox webhook
config is untouched by this runbook (only the WABA sender's own config was changed in
§2.2), so reverting the two env vars alone restores the pre-swap state fully.
