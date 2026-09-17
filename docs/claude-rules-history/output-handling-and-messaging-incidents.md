# Output Handling & Messaging — Incident History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Never pipe unfamiliar output — original prohibitions list (recognizable examples)

THE ORIGINAL PROHIBITIONS STILL HOLD, kept here as recognizable examples
  of the failure pattern above — useful for spotting a likely offender on
  sight, but supporting detail now, not the mechanism that prevents the
  next one:
    * a CLI command whose job is enumerating credentials (`supabase
      projects api-keys`, with or without `--reveal`, and anything shaped
      like it);
    * `cat`, `grep`, `sed`, `head`, or any other command that prints the
      contents — or a matched line's contents — of `.env*` or any other
      file holding real values (a NAME-only match, e.g. `grep -o
      '^[A-Z_]*='`, is fine; a match that includes `=<value>` is not);
    * an error message, stack trace, or debug log that happens to include a
      credential;
    * a diff, patch, or file read that shows a secret's actual value;
    * a CLI's own generated script or dry-run output that embeds
      connection credentials to do its job (added 2026-08-24, instance 3
      below — `supabase db dump --dry-run`'s script is the concrete case,
      but the shape generalises: any command whose PURPOSE is unrelated to
      credentials can still embed one in its output incidentally).

## Never pipe unfamiliar output — three dated incidents (2026-08-23/24)

EVIDENCE, ALL THREE, DATED PRECISELY — the enumeration approach has now
  failed twice in a row, evidence enough that a third enumeration is not
  the fix (`docs/build-status.md`'s 2026-08-23 and 2026-08-24 entries):
  (1) **2026-08-23.** `supabase projects api-keys --project-ref
  exfccwlrhoutkgrlikod` printed test-db's anon, service_role, and secret
  keys into the transcript while establishing a project-identity
  breadcrumb, in a session that had already switched to the safe
  SQL-probe pattern for every OTHER breadcrumb that same session.
  (2) **2026-08-23, same session, within the hour of (1).** Immediately
  after recording that incident and writing this rule's first (v1,
  command-specific) version, a `grep -n` against `.env.test` — checking
  which variables needed updating once key rotation happens — printed the
  full contents of every matched line, values included, a second time.
  (3) **2026-08-24**, after this rule had already been WIDENED to v2 (the
  category version, written in direct response to (1) and (2)) and that
  version was the one in effect. `supabase db dump --linked --schema
  public --dry-run`, run to build a disposable local-scaffold proof for
  migration 030's transaction-wrapper fix (per §7's own dry-run
  discipline), piped through `head -30` to inspect the generated
  `pg_dump` invocation — the script's own `export PGPASSWORD=...` line
  printed a live test-db connection password into the transcript.
  Contained: the file was deleted immediately, the dump was regenerated
  with direct redirection to a file and never printed again. Full record:
  `docs/build-status.md`'s 2026-08-24 entry.
  Neither of the first two incidents repeated the other's exact command,
  and the third repeated neither — three distinct commands, two rule
  versions, both obeyed exactly as written, the underlying hazard
  recurring anyway each time, because each version named instances of the
  class instead of the class's actual shape. This version doesn't
  enumerate; it names the shape — unfamiliar output, piped raw into
  view — so the next surprising command is already covered, not waiting
  to become instance four.

## WhatsApp message never sent without confirmation — tap-test incident

Origin: an ad-hoc-menu tap-test built and sent a real WhatsApp message to
  `+919176865600`, inferred from the one `engineer`-role `users` row on
  production (`full_name: "Vikram Rao"`, tenant `"Rajamani Constructions
  Pvt Ltd"`) rather than asked for directly. The inference turned out
  correct — the number was Aravind's own test handset — but this was
  established only AFTER the send, when asked to justify it, not before.

## One-off script never resolves own creds — third-instance incident (63015/63027)

Origin:
  the ad-hoc-menu tap-test script loaded `TWILIO_WHATSAPP_NUMBER` from local
  `.env.local` independently rather than calling `readCredentials()` — that
  file still holds the Twilio Sandbox number (`+14155238886`), stale
  relative to Vercel Production's own env (correctly `+919940875600`, per
  today's real morning/evening sends, both confirmed `status: "read"`).
  Two live WhatsApp messages were sent, both failed at Twilio before ever
  reaching the webhook (`error_code: 63015`, sandbox-join-required — a
  different mechanism from the 24-hour session window this diagnosis was
  first, wrongly, attributed to), and both were reported as "sent" on the
  strength of Twilio's initial `queued` response, never checked to a
  terminal status. **No production code path reads a local env file** —
  grepped, confirmed: `TWILIO_WHATSAPP_NUMBER` has exactly one production
  reader (`send.ts:149`, inside `readCredentials()`, populated only from
  the deployed environment); the divergence is possible only in
  hand-written, uncommitted diagnostic tooling that reimplements credential
  loading instead of reusing the real path — exactly the shape this rule
  closes. **THIRD INSTANCE, same underlying class, cited by number so a
  fourth doesn't get treated as new:** `63015` and `63027` both recurred
  during Morning Flow Pass 1's own first cron fire
  (`docs/reviews/first-successful-delivery-record.md`,
  `docs/reviews/first-cron-fire-record.md`) — this project has now hit
  "code silently talks to the sandbox instead of production" three
  separate times, in three different scripts, none of which shared a root
  cause with each other beyond the same broad failure shape. A fourth
  enumerated fix is not the answer; reusing the one already-correct
  credential path is.

