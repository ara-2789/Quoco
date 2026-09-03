# First owner delivery — 2026-09-03 09:13:18 UTC (14:43 IST)

**Recorded 2026-09-03, read-only against production, breadcrumbed via SQL
probe (`jvxwqignooseazzmwhvl`) at every step, re-linked to test-db
(`exfccwlrhoutkgrlikod`) after each round.** This is the closing artifact
for the owner-email-delivery workstream that began with migration 034: the
first time a real Daily Progress Report reached a real owner's inbox, by
email, end to end, with no manual copy-paste anywhere in the path.

## 1. The full sequence, dated

| When (UTC) | What | Where |
|---|---|---|
| 2026-08-31 | Migration 034 applied to production (schema: `notification_email`, `notification_email_verified_at`, `owner_email_verifications`, `dprs.delivery_status` widened) | `docs/reviews/034-apply-record.md` |
| 2026-09-03 06:12:15 | `owner_deliver` job handler merged — necessary, not sufficient; its own header named three missing pieces | PR #159, `5928a57` |
| 2026-09-03 06:xx (same session) | **DECIDED, not inherited**: Resend confirmed as the email provider — named in `CLAUDE.md` since the day-one scaffold (`c9fbc85`, 2026-06-28) but never actually chosen until now, on the grounds that the provider surface in `lib/email/send.ts` is ~50 lines of raw fetch (a same-size diff to swap) and Resend's test-domain path sends with no DNS lead time | `CLAUDE.md` §3, same commit as PR #159 |
| 2026-09-03 07:21:20 | Beta provisioning script merged (034 §2j/A1) | PR #162, `2ac29e9` |
| 2026-09-03 07:21:48 | Confirm-email route merged (034 §5) — GET renders, POST consumes | PR #163, `48bfc8c` |
| 2026-09-03 07:31:33 | **First real run of the provisioning script, by hand.** Steps 1–2 succeeded (owner row `fc147521-1cd4-401d-807b-015fcf44ea21` created, `projects.owner_user_id` set); step 3a stored a verification token; step 3b failed — `RESEND_API_KEY`/`RESEND_FROM_EMAIL` were set in Vercel Production but not in the local `.env.local` the script actually reads. The row (`owner_email_verifications.id = e04b6c76-...`) was already committed; the raw token existed only in that one now-dead process's memory | this incident |
| 2026-09-03 08:42:44 | Fix merged: credential/app-URL checks moved before any write in `provision-beta-owner.ts`; `scripts/resend-owner-confirmation.ts` built as the recovery path for the dead token | PR #164, `2d4dc426` |
| 2026-09-03 08:42:57 | `resend-owner-confirmation.ts` run, by hand, 13 seconds after the fix merged. New token/row minted (`owner_email_verifications.id = f128652b-...`), dead row from 07:31 left untouched | this incident |
| 2026-09-03 08:43:48.407 | Owner clicked the link, submitted the confirm form. `users.notification_email_verified_at` set | verified live |
| 2026-09-03 08:43:48.666 | `owner_email_verifications.used_at` set — **259ms after** `notification_email_verified_at` (§4 below) | verified live |
| 2026-09-03 ~09:1x | `owner_deliver` job enqueued by hand: `{"project_id": "acef67fe-e775-439d-82b8-5b8526868d6d", "log_date": "2026-09-02"}` | manual `INSERT INTO jobs` |
| 2026-09-03 09:13:18.78 | **`dprs.delivery_status = 'delivered'`, `delivered_owner_at` set.** The email arrived in `ar.rcpl@gmail.com`. Confirmed by the recipient directly, not inferred from the ledger alone | this incident |

## 2. The backlog this closes

**Verified live against production at record time, not carried over from
an earlier estimate:**

```sql
SELECT delivery_status, count(*), min(log_date), max(log_date)
FROM dprs WHERE project_id = 'acef67fe-e775-439d-82b8-5b8526868d6d'
GROUP BY delivery_status;
```
→ `delivered`: 1 row (`2026-09-02`). `pending`: **19 rows**, spanning
**2026-08-13 to 2026-09-01**.

**Stated plainly, matching this project's own audit discipline:** the
figure checked here (19 rows, 08-13→09-01) differs from an earlier
in-session estimate of "ten, 08-21→09-02" — the live count is what's
recorded, per CLAUDE.md's own "verify by observation, not by trusting a
prior claim" standing rule. Every one of those 19 rows sat at `pending`
with real, fully-generated content (`generation_status: idle`) and **no
code path capable of moving it anywhere else** — the handler existed
(migration 034) but nothing could reach a verified owner, because no owner
row, no confirm route, and no provisioning path existed yet. One of the 20
total rows for this project is now `delivered`. The other 19 remain
`pending`, still eligible for the next `owner_deliver` job run against
them (see the closing section, `docs/reviews/` companion on the `ownerSend`
route, for how they eventually get there automatically).

## 3. The Resend response-shape check — the Twilio lesson applied in advance

**This is the finding worth keeping from this whole sequence.** Migration
034's own review package, and `lib/email/send.ts`'s own header, both
flagged the same risk before a single real email had ever been sent: this
code had never received a real Resend response, and the codebase's own
prior incident with Twilio (`docs/reviews/first-cron-fire-record.md`) was
exactly this failure shape — code written against documented behavior,
never executed against the real service, breaking on first contact via a
blind `res.json()` call on a response whose `Content-Type` was never
checked.

Before the first real send, this session checked `lib/email/send.ts`
against three things, live:
1. **Parsing never assumes a Content-Type.** `res.text()` is called
   unconditionally; `JSON.parse()` runs inside a `try/catch` that degrades
   to `parseOk: false` rather than throwing. Structurally immune to the
   exact mechanism that broke the Twilio integration.
2. **Response-shape capture exists on every failure branch**
   (`describeResponseShape` — content type, body length, a correlation-only
   hash, parsed key names never values) — mirroring PR #135's Twilio
   capture, not an opaque error.
3. **The documented shape was checked against Resend's own current docs
   before this send, not after** — endpoint (`POST
   https://api.resend.com/emails`), success body (`{"id": "..."}`), and the
   error body's `message` field all confirmed to match what the code
   already expected.

**The residual risk was named explicitly before enqueueing** (a genuine
send succeeding while the HTTP response is lost/mangled in transit, or an
undiscovered divergence between documented and live behavior) — and **it
did not fire**. Resend's live response matched its documented shape
exactly; `delivery_status` reached `'delivered'` correctly, and the email
that arrived is the email the ledger says arrived. The Twilio incident was
never checked against docs before its first real call and broke on an
undocumented divergence; this one was checked first and held.

## 4. The ordering defect the failed send exposed

`provision-beta-owner.ts`'s original order checked
`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`NEXT_PUBLIC_APP_URL` only immediately
before use, in step 3b — **after** the `users` INSERT and the
`projects.owner_user_id` UPDATE had already committed. The 07:31:33 run hit
this exactly: the credential check failed only once two real writes were
already in the database, leaving a verification token stored
(`owner_email_verifications.id = e04b6c76-...`) whose raw value existed
only in that one process's memory — never logged (checked directly: no
`console.log`/`console.error` call in the script ever received it), never
transmitted (`readCredentials()` throws before any HTTP request is made).
SHA-256 is one-way; the row became permanently dead the moment the process
exited.

**Fixed** (PR #164, `2d4dc426`): `readCredentials()` (now exported from
`lib/email/send.ts`) and the `NEXT_PUBLIC_APP_URL` check both run before
any database read or write. Safe reorder, confirmed before making it —
both are pure environment reads with no dependency on the project/owner
data resolved afterward. A missing credential now fails the script before
it creates anything, not halfway through.

**The dead row was left alone, not touched** — matching 034's own
EXPIRED-TOKEN BEHAVIOUR precedent ("mints a NEW token/row rather than
reusing or extending the expired one — an expired token is dead, never
revived"). `owner_email_verifications.id = e04b6c76-...` still shows
`used_at: null` and will simply expire on its own 7-day schedule
(2026-09-10) — provably inert, since nobody has ever possessed its raw
value.

## 5. The 259ms gap — the confirm route's ordering, proven, not just coded

`app/api/owner/confirm-email`'s own POST handler writes
`users.notification_email_verified_at` FIRST, then
`owner_email_verifications.used_at` SECOND — a deliberate, documented
choice (a crash between the two leaves the owner correctly verified, with
the token merely usable for one further retry; the reverse order would
leave a dead token with the owner never actually verified). The real
timestamps, read live from production, show this ordering actually
happened, not just that the code says it should:

- `notification_email_verified_at`: `2026-09-03 08:43:48.407+00`
- `used_at`: `2026-09-03 08:43:48.666+00`

**259ms apart, verified-then-used, in that order** — the two sequential
writes this route makes, landing exactly where the code puts them, on the
one real POST that has ever hit this route.
