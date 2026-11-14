# 052 dark control: digit 4 is dark on production (14 Nov 2026)

Record for code review round 1, finding 1 (`052-code-review-round-1.md`): merge is deploy, so this is owed before the merge. Text only. Everything marked "per Aravind" was done and reported by Aravind in chat; Claude Code did not touch Vercel, env vars or any phone and has not independently observed any of it.

## What was done (per Aravind, 14 Nov 2026)
- `CAPTURE_DIGIT4_TEST_PHONES` removed from Vercel Production, then Production redeployed.
- Deployment id `BKQh9MwgHsWmgQ2hhWGpMXHFFkHz`: Production, Ready, Latest, source `main` (merge of PR #354).
- After the redeploy, Aravind replied "4" from his own phone and received, verbatim:

  > That option isn't available yet. Nothing was recorded.

## What the reply means
Digit 4 is dark. `lib/whatsapp/capture-switch.ts:6` holds `CAPTURE_DIGIT_4_LIVE = false`, and `:26` returns true only if that constant is on or the phone is in the parsed `CAPTURE_DIGIT4_TEST_PHONES` list. With the variable gone the list is empty, so `isCaptureDigit4Live` is false for every phone and a "4" gets the `item_reserved` string. A live digit 4 would instead have asked for the file (`MI_ASK_FILE`), so the reply above is the dark outcome, not the live one.

## Restore (after the prod apply and PR-D2)
Re-add `CAPTURE_DIGIT4_TEST_PHONES` to Vercel Production for Aravind's number only, then redeploy (the variable is read per request from `process.env`, so only a redeploy changes it).

Parse format, quoted from `lib/whatsapp/capture-switch.ts` (read only, at `09de1aa`):
- `:8-9`  `// E.164: "+" then 8-15 digits.` / `const E164 = /^\+\d{8,15}$/`
- `:12-15` "comma-separated E.164, whitespace around entries tolerated. ANY malformed entry (including an empty entry from a stray comma) -> empty list, i.e. fail closed. Unset or blank -> empty list."
- `:17-20` blank or unset returns `[]`; entries are split on `,` and trimmed; if any entry fails `E164` the whole list is `[]`.

So the value is one E.164 number, for example `+<country code><number>` with no spaces inside the number and no trailing comma. A malformed value fails closed (digit 4 stays dark), so a typo cannot open it to others.

## Not recorded here (unknowns)
No screenshot, `vercel env ls` listing, or timestamp for the reply is attached; the record rests on Aravind's report. Time of redeploy and of the reply not given.
