# Session state — 2026-08-21

**No prior handover file exists.** Checked before writing this: no `docs/claude/`
directory, no `2026-08-20-session-state.md`, no file matching `*session-state*` anywhere
in the repo. This is the first file of its kind — opened fresh on today's date rather
than appended to a convention that doesn't exist.

**Correction before the findings below:** asked to strike through an existing line
reading "Robust fix, tracked in #77" — searched the full repo, no such line exists
anywhere. CLAUDE.md's own entry (`WEBHOOK SIGNATURE VALIDATION IS HOST-PINNED...`)
already reads **"ROBUST FIX, TRACKED, NOT BUILT"** — correctly stated as unbuilt, not as
shipped. Not striking through anything that isn't there.

## Verified findings, 2026-08-20/21 session

1. **PR #77 was documentation-only. The webhook host-allowlist validation is NOT
   implemented.** `app/api/whatsapp/webhook/route.ts:138` on `main` is still a single
   pinned string:
   ```
   const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`
   ```
   Confirmed via `gh pr view 77 --json files` — zero `.ts` files touched (`CLAUDE.md`,
   `docs/design-decisions-beta-feedback.md`, `docs/inbound-start-trigger-plan.md` only).

2. **`morningCutoff = '15:00'` IST** — `lib/daily-logs/cutoffs.ts:50`.

3. **`parseEquipment` (`lib/whatsapp/flows/parsers/equipment.ts`) imports only
   `./lexicon`; `lexicon.ts` imports nothing.** No import chain to `quantities.ts`
   exists — direct or transitive.

4. **`"no"` at morning step 3 stores `{items: [], none: true, raw_text: "no"}`.**
   `025_evening_productivity_reconciliation.sql:489-490` skips evening Q5 on
   `jsonb_array_length(v_morning_equipment->'items') = 0`. Auto-skip confirmed.

## Open items (numbered here for the first time — no prior list existed to inherit from)

1. Twilio sender swap to the production WABA number — unauthorized
   (`docs/twilio-sender-swap-runbook.md`).
2. `refuse-when-submitted` RPC fix (`design-decisions-beta-feedback.md` §10) —
   unauthorized, trips CLAUDE.md §0(a), needs full external review.
3. Production Meta template submission — unauthorized
   (`docs/reviews/whatsapp-template-submission-status.md`).
4. PP2's cron + outbound-send primitive (#69/031, PR #69) — moved to the head of the
   build sequence per `design-decisions-beta-feedback.md` §27;
   `routeInboundMessage`'s no-active-session branch is scaffolding pending this.
5. Webhook signature-validation host allowlist — tracked, not built (CLAUDE.md's
   `WEBHOOK SIGNATURE VALIDATION IS HOST-PINNED` entry; finding 1 above).
6. **Production WABA sender's own inbound webhook wiring — separately unwired**
   (a different Twilio config surface from the sandbox's own field, fixed 2026-08-20;
   `docs/twilio-sender-swap-runbook.md` §1 traces `TWILIO_AUTH_TOKEN`'s
   account-dependency for this).
   **HARD GATE (2026-08-21): item 5 (the host allowlist) lands BEFORE item 6 is wired,
   not after.** Wiring the production inbound webhook to the same single-pinned-string
   validation that just broke for a day on the sandbox reintroduces the identical
   failure mode on a surface with no sandbox fallback to catch it.
