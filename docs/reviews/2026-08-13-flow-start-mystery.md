# 2026-08-13 flow-start mystery

**Provenance:** verbatim from `CLAUDE.md` L2259-2305 ("OPEN QUESTION — SHARPER
NOW, STILL UNRESOLVED..."), originally recorded 2026-08-15. Rescued into this
file 2026-08-22 as part of a pre-split audit that found this entry falls past
CLAUDE.md's ~150,000-character read window and is not duplicated anywhere
else in the repo (`docs/design-decisions-beta-feedback.md`, `docs/plans/`,
`docs/reviews/`, and open PR bodies #67/#69/#71 were all grepped and came back
empty for this specific finding — see the tail-audit at
`/tmp/claude-md-tail-audit.md`, block 68). CLAUDE.md itself is unedited by this
rescue — this is a copy, not a move.

**Status: OPEN. Not closed by this rescue** — see the 2026-08-22 note below,
which corrects one factual claim in the original text and adds a framing the
original never stated plainly, but leaves the actual question (how did
`ENABLE_TEST_FLOW_TRIGGER` come to be reachable on 2026-08-13, and when/why did
it change) unresolved.

---

## Original entry (verbatim, CLAUDE.md L2259-2305, 2026-08-15)

OPEN QUESTION — SHARPER NOW, STILL UNRESOLVED, INVESTIGATED READ-ONLY 2026-08-15: the
2026-08-13 morning check-in DID demonstrably happen — `daily_logs` row `34f8bbb5...`,
`morning_submitted_at 2026-08-13 04:30:57.055608+00` (10:00:57 IST), real content
(`morning_plan: "Excavation of 1000 sq m earth"`, `morning_equipment` containing the
already-documented "Job 15oo" typo, etc. — matches this file's own EQUIPMENT
`daily_hire_cost` incident entry verbatim, confirming this is genuine historical data, not
fabricated). With the env var confirmed absent today and exactly one `startFlow: true`
call site in the entire codebase, this should not have been possible. Investigated, not
guessed at:
  * `git log --follow` on `test-trigger.ts`: ONE commit ever, `61d8b39` (2026-07-07) — the
    file has never been modified since creation. `git show` on that commit confirms the
    gate's shape was IDENTICAL from day one (env var + exact-token check, both required)
    — the gate was never looser at any point in this repo's history.
  * No audit/event table exists for "how a flow was started" — `whatsapp_sessions` carries
    only current state (no history columns), `processed_messages` stores only
    `message_sid` + timestamps (no body, no phone number). Neither directly names a
    mechanism.
  * `processed_messages` DOES show something load-bearing: five real Twilio-delivered SIDs
    in the window `2026-08-13 04:17:43 → 04:30:56 UTC`, the last one 1 second before
    `morning_submitted_at`. A morning flow start + 4 real answers (Q1-Q4) is exactly 5
    messages. A DIRECT out-of-band RPC call (bypassing the webhook to set
    `p_start_flow=true`) would write NOTHING to `processed_messages` at all — that table
    is only ever written by the webhook's own idempotency check, never by the RPC — so a
    bypass-plus-4-real-answers scenario would predict 4 rows, not 5. Five were found.
  * `dispatchMorningFlow`'s pure mirror (`morning.ts`, AUTHORITY NOTE: mirrors the RPC,
    tested against it directly) confirms outcome `'start'` is reachable from EXACTLY ONE
    branch: `startFlow === true && session.current_flow === null`. No other path — no
    next-day reset, no other outcome — ever produces `'start'`.
  * Grepped `scripts/` for any utility that calls `apply_morning_flow_turn` at all: none
    exists. No dev/seed script in this repo is capable of starting a flow, direct-RPC or
    otherwise.
  **Net read of the evidence, stated at its actual strength, not overclaimed:** everything
  found is CONSISTENT WITH, and the message-count argument specifically FAVORS, "the
  test-trigger fired via a real WhatsApp message, meaning `ENABLE_TEST_FLOW_TRIGGER` was
  `'true'` on Vercel production on 2026-08-13 and has since been removed" — over "a direct
  RPC bypass," which the message count argues against but cannot fully exclude (e.g. a
  bypass call could have been followed by coincidental real traffic). **Two things remain
  genuinely unconfirmable from here and are NOT settled:** the literal body of the first
  SID (`SM24c6712f...`, 04:17:43 UTC) was never read — only its existence and timing are
  known; and Vercel does not expose historical env-var values through what's accessible
  today, only current state, so the variable's value ON 2026-08-13 specifically cannot be
  directly verified, only inferred from this evidence. **Recorded as the leading,
  evidence-supported candidate — not as a settled answer.**
  **THE CONSEQUENCE, one line, stated plainly:** if the variable was set then and is
  confirmed absent now, the only successful production conversation this system has ever
  had happened under a configuration that no longer exists — and nobody currently knows
  when it changed, or why.

---

## 2026-08-22 dated note — correction, security framing, still OPEN

**Correction to the closing claim.** The original text's last line ("the only
successful production conversation this system has ever had") is now false and
is corrected here rather than edited in place, per this project's own
provenance discipline (CLAUDE.md §0, "artifact provenance is pinned, not
paraphrased" / dated corrections, not silent rewrites):

- A second, independent, full production conversation has since happened.
  Verified live against prod (`jvxwqignooseazzmwhvl`) on 2026-08-22, not
  taken on trust:

  ```
  $ supabase db query --linked "SELECT id, project_id, engineer_id, log_date, morning_submitted_at, evening_submitted_at FROM daily_logs WHERE id = '303fb071-2afa-4b08-92cf-ab7202730051'"
  {
    "engineer_id": "3534756b-2a32-4b91-954b-0bab15c2dba1",
    "evening_submitted_at": null,
    "id": "303fb071-2afa-4b08-92cf-ab7202730051",
    "log_date": "2026-08-21",
    "morning_submitted_at": "2026-08-21 03:46:44.277852+00",
    "project_id": "acef67fe-e775-439d-82b8-5b8526868d6d"
  }
  ```

  A full morning check-in completed end-to-end on 2026-08-21
  (`morning_submitted_at` populated, real `project_id`/`engineer_id`).

- This second conversation is NOT a repeat of the 2026-08-13 mystery. It runs
  through a **legitimate, understood** mechanism: PR #76
  (`feat/inbound-start-trigger`, merged 2026-08-20T16:28:00Z) shipped
  `lib/whatsapp/inbound-start.ts`'s `routeInboundMessage`, which lets an
  engineer's own inbound WhatsApp message start a flow when none is active —
  no env flag, by design (per that PR's own header comment, quoted in its PR
  body: *"a flag is a config surface that can be silently wrong, and blast
  radius is smallest right now"*). So as of 2026-08-20, production has a
  **second, known-legitimate** flow-start path that did not exist on
  2026-08-13. The mystery is specifically about the FIRST path — the
  env-gated test sentinel firing on 2026-08-13 despite `ENABLE_TEST_FLOW_
  TRIGGER` being confirmed absent two days later — and that mystery is
  UNCHANGED by PR #76's existence. PR #76 explains how a *later* legitimate
  check-in could happen; it explains nothing about how the *original* one did.

**Security framing — stated plainly, which the original entry does not.** The
original 2026-08-15 write-up treats this as a data-provenance/investigation
question ("was this test data real, and how did it get here"). It does not
say the sentence that actually matters:

> **If `ENABLE_TEST_FLOW_TRIGGER` was set to `'true'` on Vercel production on
> 2026-08-13, then a test-only flow-start trigger was reachable in
> production, and anyone who held the token — the literal string
> `__quoco_start_morning__` sent as a WhatsApp message body — could start a
> morning flow for any registered phone number, with no other
> authentication.** `test-trigger.ts`'s own gate is a shared secret embedded
> in a message body, not a per-user credential; if it was live, it was live
> for anyone who had it, not just the person testing.

This is a credential-exposure question, not only a data-hygiene one. Nobody
currently knows when the variable was set, when it was removed, or why either
event happened — that is still true as of this note, and is not resolved by
either the 2026-08-21 check-in or PR #76. Both of those close off *consequences*
(there is now a legitimate way to start a flow, so the misconfigured one
matters less operationally) without closing the *question* (what was
production's actual security posture between whenever the variable was set and
2026-08-15, and does anything else in this account still carry a similarly
undocumented, silently-changed configuration).

**Carried forward as OPEN**, not closed:
1. When was `ENABLE_TEST_FLOW_TRIGGER` set to `'true'` on Vercel production,
   and when was it removed? (Vercel does not expose historical env-var values
   through what's accessible today — this may be permanently unanswerable
   without a Vercel support/audit-log request.)
2. Who had access to set it, and was that access appropriate at the time?
3. Given the security framing above, should this be treated as a past
   credential-exposure incident requiring disclosure/review, even though its
   practical blast radius (test-trigger reachability) has since been reduced
   by PR #76 shipping a legitimate path?
