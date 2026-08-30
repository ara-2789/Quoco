# Twilio production sender swap + supervised live run (JJ4 runbook)

~~**Status: WRITTEN, NOT EXECUTED, per direct instruction (JJ4). Both the sender swap
(HH2/II4) and the supervised live run below need their own go-ahead — this document
exists so the full sequence can run in one sitting once authorized, rather than being
reconstructed from a chat transcript at that point.**~~

**STATUS: SENDER SWAP EXECUTED, 2026-08-30 (Aravind). The supervised live run (§4)
has not — that's a separate go-ahead, still outstanding.** What actually changed:

- `TWILIO_WHATSAPP_NUMBER` in Vercel → `Config` type, **Production only** →
  `whatsapp:+919940875600`.
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` — **unchanged.** The production WABA
  sender lives under the **same** Twilio account as the sandbox, confirmed directly
  (§1's own unresolved question, now closed) — see the new note in §1 below. The
  SID/Auth-Token mismatch hazard §0 and §1 both warned about **never applied**; only one
  env var actually needed to change.
- Twilio Console, production WABA sender's own Messaging configuration:
  - Incoming webhook → `https://app.quoco.co.in/api/whatsapp/webhook`, HTTP POST — as
    named in §2.
  - **Status callback → `https://app.quoco.co.in/api/whatsapp/status-callback`, HTTP
    POST — a step this runbook never named.** See the new note in §2 below for why this
    matters as much as the incoming webhook did.
- Redeployed at commit `c75d679`.
- **Verified, same session, read-only against production:** an inbound sent to the new
  number produced a `processed_messages` row (`SMc2e59db50827fa6f42f11adc1cb892cc`,
  `2026-08-30 18:10:19 UTC`) — signature validation passed against the pinned allowlist,
  the first real production exercise of that mechanism. `whatsapp_sessions` and today's
  `daily_logs` row for the test engineer were both confirmed untouched by that inbound
  (`updated_at`/`created_at` unchanged from this morning's completion) — the idle inbound
  was handled correctly, no flow started, retirement held regardless of which sender the
  message arrived through.

**CORRECTED, 2026-08-30 — THIS IS NO LONGER AN IMPROVEMENT QUEUED BEHIND OTHER WORK. IT
IS A HARD PREREQUISITE.** Confirmed directly against Twilio's current docs
(`twilio.com/docs/whatsapp/sandbox`): *"You can't use custom message templates with the
Sandbox. To set up and use custom message templates, you need to register a WhatsApp
sender."* Every one of this project's 15 approved templates is a custom message
template. **No template will ever deliver from the sandbox — not intermittently, not
under some conditions, never** — and nothing past "Twilio accepted our HTTP request
synchronously" can be verified until this swap happens: not Meta actually receiving the
template, not the message arriving on a real device, not an engineer replying, not a
session advancing past step 1 for a template-triggered flow. Real production incident
that surfaced this, same day: a real `outbound_sends` row reached `status='sent'` with a
genuine `twilio_sid` (the JSON-response fix, PR #139, proven working) and was then
flipped to `status='failed'` by a real, signature-validated status callback reporting
Twilio error 63027, "Template does not exist for a language and locale" — the template
genuinely does not exist in the sandbox's own scope. Ten days of other corrections to
this runbook follow below, all dated 2026-08-30, all subordinate to this one: the swap
comes first.

~~**Depends on:** the II3 inbound-start-trigger build (`lib/whatsapp/inbound-start.ts`)
being merged and deployed — this is what makes Step 3 below ("message the number, get a
real reply") work at all. Before this build, an inbound to an idle engineer got silence
(CLAUDE.md's "BOT-07 SILENCE" entry); the live run below assumes that's fixed.~~
**CORRECTED, 2026-08-30: the II3 build this depended on has since been RETIRED**
(`design-decisions-beta-feedback.md` §38, 2026-08-28) — inbound can no longer start a
flow at all, idle or otherwise. **Depends on now:** item E's two trigger crons
(`app/api/cron/morning-trigger`, `app/api/cron/evening-trigger`), live since PR #129 and
scheduled in `vercel.json` — these are the sole flow-starter this runbook's own §4 (as
rewritten, 2026-08-30) actually relies on.

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
      ~~STALE, 2026-08-30 — see §4's own header: this precondition described the II3
      inbound-start mechanism, which retirement removed. There is no longer a reply-only
      path that skips template delivery; every real flow start now goes through a real
      template send.~~
- [ ] `CRON_SECRET` is provisioned in Vercel (§8) and a deploy has happened since — the
      II3 build's PR merge triggers a deploy; confirm that deploy is the one live before
      starting.
- [ ] **NEW, 2026-08-30.** No engineer currently has `whatsapp_sessions.current_flow IS
      NOT NULL` — confirm with a direct, read-only query before touching Vercel. One
      `TWILIO_AUTH_TOKEN` env var validates every inbound signature check regardless of
      which number the message arrived through (confirmed against
      `app/api/whatsapp/webhook/route.ts` — exactly one `process.env.TWILIO_AUTH_TOKEN`
      read, one `validateTwilioSignature` call site). §1's own unresolved question — same
      account or a different one — determines whether this matters: if the production
      sender sits under a different Twilio Account, swapping the token silently breaks
      every reply on an already-active sandbox conversation the instant it lands. The
      sandbox's own webhook config is untouched by this runbook (§5), so an in-flight
      conversation keeps posting to the same route with a token that may no longer match
      — read by the engineer as pure silence, with nothing in this runbook's own
      verification steps (framed entirely around the NEW number) prompting anyone to
      check for it.
- [ ] **NEW, 2026-08-30.** If the supervised live run (§4) targets a specific engineer,
      confirm that engineer's `daily_logs.attendance` for the run's date is not
      `'site_holiday'` — `filterEveningRoster` excludes that engineer from the evening
      roster entirely (`design-decisions-beta-feedback.md` §30(b)), so the evening leg
      of §4 will simply never fire for him. Observed for real, 2026-08-30 — not a
      hypothetical caveat.

## 1. What actually changes on swap — traced, not assumed

~~Two, and only two, code paths read Twilio env vars~~ **CORRECTED, 2026-08-30 — THREE,
not two, and the third is now the primary reason this swap matters.** The enumeration
below predates the outbound-send primitive (items B–F, PR #120/#126, shipped after this
runbook was written); the two original bullets are unchanged and still correct for what
they each individually claim, but the closing line on `TWILIO_WHATSAPP_NUMBER`
("purely cosmetic... does not affect message delivery") is true only for that ONE call
site and reads, taken as a summary of the whole variable, as dangerously wrong today.

- `app/api/whatsapp/webhook/route.ts:122` — `TWILIO_AUTH_TOKEN`, used to recompute the
  HMAC-SHA1 signature Twilio attaches to every inbound webhook call
  (`validateTwilioSignature`). ~~If the production WABA sender lives under a different
  Twilio Account (a different Account SID) than the sandbox, its Auth Token is also
  different — swapping only the phone number while leaving the sandbox's Auth Token in
  place would make every real inbound fail signature validation (403), not silently
  degrade. Confirm which is true (same account, new number vs. genuinely new
  account/subaccount) before touching anything — Twilio Console → Account → General
  Settings shows the Auth Token for whichever account is currently active.~~
  **RESOLVED, 2026-08-30: same account, confirmed directly by Aravind before the swap.**
  `+919940875600` lives under the identical Twilio Account as the sandbox number — no
  Account SID or Auth Token change was needed, and the hazard this bullet warned about
  (a silently-broken Auth Token orphaning an in-flight sandbox conversation, §0's own new
  precondition) never had a chance to occur. Only `TWILIO_WHATSAPP_NUMBER` changed.
- **NEW, 2026-08-30 — `app/api/whatsapp/status-callback/route.ts:52`.** A fourth reader
  of `TWILIO_AUTH_TOKEN`, missed in the "three, not two" correction above — its own
  independent `process.env.TWILIO_AUTH_TOKEN` read and `validateTwilioSignature` call,
  validating Twilio's async delivery-status callbacks the same way the inbound webhook
  validates messages. Doesn't change what to DO (same env var, already covered by the
  swap), but widens what an Auth Token mismatch would have broken, had the accounts
  differed: not just inbound replies, but delivery-status correlation itself — see this
  file's own header for why that specific mechanism matters (it's what caught 63027).
- `app/(dashboard)/daily-logs/page.tsx:69` — `TWILIO_WHATSAPP_NUMBER`, read for the
  DASH-03 reactivation CTA display only (formats and shows the number a blocked
  engineer should text START to). Purely cosmetic for THIS call site specifically; a
  stale value here degrades one CTA, it does not affect message delivery **on its own —
  see the new bullet below for the call site where it does.**
- **NEW, 2026-08-30 — `lib/whatsapp/outbound/send.ts`'s `readCredentials()`.** Reads
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, **and `TWILIO_WHATSAPP_NUMBER`** fresh on
  every real send — this is the `From` number on every outgoing template message,
  called by `triggerCheckIn` (`lib/whatsapp/outbound/trigger.ts`) on every cron fire.
  **This is now the primary reason `TWILIO_WHATSAPP_NUMBER` matters at all** — the
  daily-logs CTA display above is a separate, minor, second reader of the same variable,
  not the main one. Confirmed against Twilio's own docs (`twilio.com/docs/whatsapp/
  sandbox`): custom templates cannot be sent from the sandbox at all, so as long as this
  read resolves to the sandbox number, every real send fails structurally — see this
  file's own header, 2026-08-30.

`TWILIO_ACCOUNT_SID` ~~is declared in CLAUDE.md's env var list but has zero readers in
the codebase today (grepped `app/`, `lib/` — no hits) — reserved for the future
outbound-send primitive (#69/031), not live yet. Setting it now is harmless but not
load-bearing for this swap.~~ **CORRECTED, 2026-08-30: that primitive now exists and
reads it** — `send.ts`'s `readCredentials()`, same bullet as above. No longer merely
harmless-but-inert; it is load-bearing for every real send, same as the other two.

## 2. Swap steps

1. In Vercel → Project → Settings → Environment Variables (Production):
   - `TWILIO_WHATSAPP_NUMBER` → the real WABA-approved sender, in Twilio's
     `whatsapp:+<E.164>` format (matching the existing sandbox value's shape,
     `whatsapp:+14155238886`).
   - `TWILIO_AUTH_TOKEN` → the Auth Token for whichever Twilio account now owns that
     sender (per §1 above — do not assume it's unchanged).
   - **DONE, 2026-08-30 — recorded exactly as executed.** `TWILIO_WHATSAPP_NUMBER` set
     as `Config` type, **Production environment only**; `TWILIO_AUTH_TOKEN` left
     unchanged (same-account finding, §1). **Preview was deliberately left scoped
     separately, still pointing at the sandbox** — a PR preview deploy cannot message a
     real number through the approved WABA sender, only through the sandbox (join-code
     gated, same as every test send before this swap). Worth stating as a deliberate
     safety property, not an oversight: this runbook never discussed Preview at all
     before now.
2. In Twilio Console → the WABA sender's own configuration (not the sandbox's) → ~~set
   the inbound webhook URL to `https://<production-domain>/api/whatsapp/webhook`, HTTP
   POST~~ **NAMED EXACTLY, 2026-08-30 (previously left as a placeholder):**
   - **Field:** the production WABA sender's own Messaging configuration → **"When a
     message comes in"** webhook URL.
   - **Value, exactly, no substitution:**
     ```
     https://app.quoco.co.in/api/whatsapp/webhook
     ```
     This is `PRODUCTION_WEBHOOK_ORIGIN` (`lib/whatsapp/twilio-signature.ts`), verbatim,
     plus the route's own path — **not** a placeholder to fill in per-environment.
     `PRODUCTION_WEBHOOK_ORIGIN` is the pinned literal the signature-validation allowlist
     tries first (see §3's own new note below); pointing Twilio at anything else — an old
     `.vercel.app` host, a preview URL, any typo — fails validation against both
     allowlist candidates and 403s, with no ambiguity about cause once that allowlist is
     accounted for.
   - **Method:** HTTP POST — the exact same route, no code change; only the sandbox's
     separate webhook config pointed elsewhere before.
2b. **NEW, 2026-08-30 — a step this runbook never named, found only after the swap was
    already planned and corrected here from what was actually done.** The production
    WABA sender's Messaging configuration also needs its **status callback URL** set,
    separately from the incoming-message webhook in step 2 above:
    - **Field:** the same Messaging configuration section → **status callback URL**
      (Twilio's own delivery-status webhook, distinct from "When a message comes in").
    - **Value, exactly:**
      ```
      https://app.quoco.co.in/api/whatsapp/status-callback
      ```
    - **Method:** HTTP POST.
    - **Why this matters as much as step 2 did:** without it, Twilio has nowhere to
      report an async delivery failure on the new sender — `app/api/whatsapp/status-
      callback/route.ts` (§1's own new bullet above) would never be called at all, and
      `outbound_sends` rows would sit at `status='sent'` regardless of what actually
      happened to the message. **This is the exact mechanism that correctly caught
      today's 63027 finding** (this file's own header) — a swap that changed the sender
      but left this URL unconfigured on the sandbox's old value (or unset) would have
      traded one invisible failure mode for another: template delivery might work, but a
      genuine failure downstream of Twilio's synchronous accept would go undetected,
      exactly the gap `docs/reviews/first-cron-fire-record.md`'s own "2xx means ACCEPTED,
      not DELIVERED" finding warned about.
3. Trigger a new Vercel deploy (or confirm the env var change alone takes effect —
   Vercel env vars are read at request time for these two call sites, not build time, so
   a redeploy is not strictly required, but doing one removes any doubt). **CORRECTED,
   2026-08-30: "these two call sites" now means three — §1's own new bullet
   (`send.ts`/`trigger.ts`) reads its env vars the identical way (plain
   `process.env.TWILIO_*`, no `NEXT_PUBLIC_` prefix, read fresh per call) — the same
   redeploy-not-strictly-required reasoning applies to it too, not just the original
   two.**

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
  - **ADDED, 2026-08-30 — this troubleshooting step is now strictly more reliable than
    when it was written, worth stating explicitly.** `lib/whatsapp/twilio-signature.ts`
    now validates against an ALLOWLIST (the pinned literal `PRODUCTION_WEBHOOK_ORIGIN`
    plus `NEXT_PUBLIC_APP_URL` as a second candidate) rather than the single
    env-derived string that caused a full day of silent 403s on 2026-08-19/20 (that
    fix's own header names the incident). **Provided Twilio's webhook is pointed at the
    pinned literal exactly (§2 above), a 403 here can now only mean the Auth Token is
    wrong — a host/domain mismatch is structurally ruled out.** Before this fix, the
    same 403 could have meant either cause; this step's own diagnosis is now
    unambiguous.
- [ ] Register a real (or dedicated test) engineer against the new number, active
      status, real project membership.
- [ ] ~~Message the number as that engineer. Expect: per this build (II3), a REAL
      reply — either the morning Q1 prompt, or `REPORT_READY_REPLY` if run after 19:45
      IST — not silence. This is the first time this build's production behaviour and
      the real production sender are proven together, not separately.~~
      **CORRECTED, 2026-08-30 — this described the II3 inbound-start-trigger
      mechanism, which retirement removed (`design-decisions-beta-feedback.md` §38).
      Messaging an idle engineer can no longer produce the morning Q1 prompt at all —
      no idle inbound starts a flow anymore.** Message the number as that engineer and
      expect ONE of the four static acknowledgement strings instead (§38), depending on
      time of day and submission state — e.g. `"Good morning. Your check-in will arrive
      shortly — it comes to you automatically"` before `morningCutoff`, or
      `MORNING_WINDOW_CLOSED_REPLY` after it. **Getting any of the four (or
      `REPORT_READY_REPLY`/`EVENING_ALREADY_COMPLETE_REPLY` if the day is already
      closed out) still proves the same thing this step originally existed to prove —
      signature validation passing, a real reply reaching the engineer — the specific
      TEXT expected is what changed, not the step's purpose.** See §4 below for how to
      actually get Q1 now.

Do not proceed to §4 until every box above is checked by direct observation.

## 4. The supervised live run

**REPLACED, 2026-08-30, not amended — the original procedure below assumed the II3
inbound-start-trigger mechanism, which `design-decisions-beta-feedback.md` §38's
retirement removed entirely (2026-08-28). Struck through and kept for the record, per
this project's own correction discipline, not because it still applies.**

~~Once §3 passes, this is the actual product test: a complete, real, end-to-end check-in
by a human, through to delivery.~~

~~1. Aravind messages the production number from his own phone. No active session, no
   prior submission today → per this build, gets the morning Q1 prompt.~~
~~2. Complete the full morning flow (Q1-Q4) with real answers.~~
~~3. Wait for or manually trigger the point where the evening window opens (per
   `CHECKIN_CHECKPOINTS.eveningSend`, 18:30 IST) — or, per this build's own accepted
   early-volunteer case (`docs/inbound-start-trigger-plan.md` (a), row 3), message the
   number again any time after morning completes; evening starts immediately rather than
   waiting for 18:30.~~
~~4. Complete the full evening flow.~~
~~5. At 19:45 IST (`eveningClose`), confirm the DPR actually generates: a new `dprs` row
   for today, for Aravind's project/engineer, with real content (not
   `skipped_no_data` — there IS data this time). Check directly against the database,
   not the PM dashboard alone.~~
~~6. If the owner-delivery path (`dpr-24`, 20:30 IST `ownerSend`) is also live, confirm
   the email arrives. If it is not yet live, stop at step 5 and note that explicitly
   rather than treating an unsent owner email as a failure of this run.~~

**THE ACTUAL PROCEDURE NOW, 2026-08-30.** Neither the morning message nor the
early-volunteer evening start can be self-initiated by messaging in anymore — the CRON
is the sole flow-starter (§28(w)'s own decided shape, cited in `lib/whatsapp/
inbound-start.ts`'s own retirement header). The mechanism to trigger it manually is
already exercised and recorded — `docs/reviews/first-cron-fire-record.md`'s own "Dated
observation" section — not new or unproven.

1. **Confirm the two new preconditions in §0** — no engineer has an active session, and
   the target engineer's `attendance` for today isn't `'site_holiday'` — immediately
   before starting, not hours before.
2. **Trigger the morning cron manually**: Vercel → Cron Jobs → `Run` on
   `/api/cron/morning-trigger`. (Or wait for the real 08:30 IST fire — manual trigger
   exists so this run doesn't depend on the clock.)
3. **Confirm the template actually arrives** on the target engineer's real device,
   from the new production number — not the sandbox. This is the first real proof the
   swap works for template delivery specifically, not just plain-reply signature
   validation (§3 only proved the latter).
4. Reply through the flow normally (Q1–Q4) — this path is UNCHANGED by retirement;
   retirement only touched the idle branch, never flow continuation once a session is
   active.
5. **Trigger the evening cron manually**: Vercel → Cron Jobs → `Run` on
   `/api/cron/evening-trigger`. (Or wait for 18:30 IST.) There is no more
   early-volunteer path that starts evening early by messaging in after morning
   completes — that mechanism was retired along with morning's.
6. Complete the full evening flow via inbound replies, same as step 4.
7. At 19:45 IST (`eveningClose`), confirm the DPR actually generates: a new `dprs` row
   for today, for the target engineer's project, with real content (not
   `skipped_no_data` — there IS data this time). Check directly against the database,
   not the PM dashboard alone.
8. If the owner-delivery path (`dpr-24`, 20:30 IST `ownerSend`) is also live, confirm
   the email arrives. If it is not yet live, stop at step 7 and note that explicitly
   rather than treating an unsent owner email as a failure of this run.

**EXPECTED POSITIVE SIGNAL, worth watching for explicitly (2026-08-30):** after step 2
or step 5, a clean `outbound_sends` row reaching `status='sent'` with a real
`twilio_sid` and NO subsequent async flip to `status='failed'` is itself the
confirmation that error 63027 (this file's own header) is resolved — that single
observation proves the sandbox-vs-WABA template mismatch is gone, distinct from and in
addition to the DPR/delivery confirmation in steps 7–8.

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
