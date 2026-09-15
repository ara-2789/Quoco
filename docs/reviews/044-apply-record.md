# Migration 044 — production apply record (2026-09-15)

Companion to `docs/reviews/044-review-package.md` (the full external
review package — round 1 plus the round-2 fold-and-return, all raw
evidence) and `supabase/migrations/044_hindrance_photos.sql` (the applied
file itself, carrying its own dated correction inline). **Applied by
hand, outside this session** — this document is the post-apply paperwork,
written from the facts reported after the fact, not re-derived or
independently re-run. The CLI link was back on test-db
(`exfccwlrhoutkgrlikod`) by the time this record was written; **no
database connection of any kind was made while writing it** — every fact
below is pasted verbatim from what was reported, not re-probed.

## External review — a fold-and-return whose principal finding was the same shape as a bug already found internally

Round 1 (build) went to external review and came back **FOLD-AND-RETURN**,
four findings (S1-S4):

- **S1, the principal finding.** The Q3 photo handler resolved which
  hindrance a photo belongs to via `resolveMostRecentHindranceId` — a
  "most recent report for this reporter" lookup. Its own safety comment
  fenced only the writer that exists TODAY (the hindrance flow itself); it
  said nothing about a non-flow writer, and one is already named in this
  project's own artifacts — DASH-10, the unbuilt hindrance-editing
  dashboard surface, cited in migration 039's own grant commentary. The
  moment any PM/dashboard path ever inserts a hindrance for the same
  reporter mid-session, "most recent" would silently attach that session's
  photos to the WRONG row — no constraint fires, evidence photos
  cross-attributed on an owner-visible record. **Named explicitly, by the
  reviewer, as the identical failure shape as the `was_unspecified` bug
  this same migration had already found and fixed internally, one layer
  up**: re-deriving from adjacent state a fact the system already
  established, on an earlier turn, instead of carrying it forward. Fixed
  by carrying `hindrance_id` through `whatsapp_sessions.context` (the
  exact mechanism `hindrance_unspecified` already used) and **deleting
  `resolveMostRecentHindranceId` entirely**, not fencing it — both call
  sites now receive the id directly from their own caller, which already
  has it from the RPC.
- S2 (stale subtract-list completeness claims), S3 (`retention_class`'s
  COMMENT made precise), S4 (the shared retry budget recorded as an
  accepted trade) — all folded in; full text and reasoning for all four:
  `docs/reviews/044-review-package.md`'s own "External review round 2"
  section.

All four re-verified against test-db (a full re-teardown/re-apply cycle,
both RPC transcripts re-run against the amended function, the DOWN block
re-rehearsed against a live in-flight step-3 session — restored function
body hash byte-identical to the pre-044 capture both times) before PR #275
was considered ready again.

## The CI-never-actually-ran incident on PR #275

**A genuine content conflict — this branch's own new
`HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY` constant landing adjacent to lines a
separately-merged item-12 fix also touched — left PR #275 in a
CONFLICTING mergeable state, which silently blocked GitHub Actions from
ever triggering `pull_request`-event CI on it at all.** The same symptom
CLAUDE.md's own standing rule already names for PR #244 ("a
DIRTY/CONFLICTING mergeable status blocks GitHub from computing the merge
ref some workflow trigger paths depend on"), here from a real conflict
rather than squash-broken ancestry. **The practical consequence: "no CI
has run yet" and "CI is green" were indistinguishable at a glance** — the
PR showed no failing checks for the same reason it showed no passing
ones, for its entire life until this was found. Resolved by merging
`origin/main` into the branch (a regular merge commit, not the PR itself,
never touching `main` directly) — CI then ran for the first time and
passed, all 9 checks, including a real `Test (real test-db)` run
(21m23s).

**The reviewer's own proposed convention, recorded here so it isn't
lost**: a review submission should pin the actual CI run URL at the
reviewed SHA, not merely assert "CI green" — a claim with no run behind it
reads identically to one with a passing run behind it, and this incident
is the reason that distinction now matters enough to require the URL,
not just the words.

## Sequence followed, in order

1. **PITR observed live**, before applying. Restore window **08 Sep 2026
   22:00:34 to 15 Sep 2026 00:03:53 IST** — confirmed directly in the
   Supabase dashboard, not assumed from a checklist line, per CLAUDE.md
   §0's own "rollback mechanisms are verified by observation" rule.
2. **Pre-apply function hash** (the live `apply_hindrance_flow_turn`
   BEFORE 044 — 038's own body, unchanged by any migration between 038
   and 044):
   ```
   abdac08cd997bb2e3d8d73773d807a24
   ```
3. **Pre-apply probe on prod** (`jvxwqignooseazzmwhvl`):
   ```
   table_exists = NULL
   status_col = 0
   ```
   Confirms the table and the `hindrances.photos_status` column genuinely
   did not exist yet — the apply was not re-running something already
   there.
4. **Applied.** `supabase db query --linked -f
   supabase/migrations/044_hindrance_photos.sql` — no error.
5. **Post-apply readback on prod**:
   ```
   table_exists = hindrance_photos | status_col = 1 | rls_enabled = true | policy_count = 1 | post_044_hash = 09b4e083638dd359b6415a71f6146bec
   ```
   **The hash pair (`abdac08c...` → `09b4e083...`) is the record that the
   RPC rewrite landed** — this is what any future rollback of 044 must
   restore `apply_hindrance_flow_turn` back to.
6. **Generated column expression, read back via `pg_get_expr`**:
   ```
   attname = expires_at
   generated_expr = timezone('UTC'::text, (timezone('UTC'::text, received_at) + '60 days'::interval))
   ```
   Single-interval form, no `CASE` — matches this table's own single
   retention class, exactly as designed (`hindrance_photos` has one class,
   unlike `daily_log_photos`' two).
7. **The four-way negative grants matrix, PROD, the SOLE authoritative
   grants record.** Named explicitly as such because test-db's own matrix
   no longer agrees by design: `scripts/test-db-only-grants.sql`
   deliberately grants `service_role` DELETE on this table, test-db only,
   so a test-db reading of this exact query would show `del = true` —
   that is the accepted divergence, not a discrepancy with the row below.
   ```
   rolname       | sel   | ins   | upd   | del   | trunc | refs  | trig
   authenticated | true  | false | false | false | false | false | false
   anon          | false | false | false | false | false | false | false
   service_role  | true  | true  | true  | false | false | false | false
   ```
8. **Ledger repaired.** `supabase migration repair --status applied 044
   --linked` succeeded ("Repaired migration history: [044] => applied").
   `supabase migration list --linked` shows Local and Remote matching
   through 044, no gaps.
9. **File promoted, this pass.** `git mv
   docs/reviews/044_hindrance_photos.sql
   supabase/migrations/044_hindrance_photos.sql`, per CLAUDE.md's "a
   migration file enters `supabase/migrations/` when it is being applied,
   not when it is written" rule — done now that the apply is real, not
   before. Header's own "held, not applied to prod" / "needs the full
   review package before it applies anywhere beyond test-db" attestations
   struck through, not rewritten, per the 036/039/042/043 precedent; a
   dated correction records the apply, the external review outcome, and
   the ledger repair inline.
10. **Types regenerated** — 54 insertions to `types/database.ts`,
    confirmed by grep to contain `hindrance_photos`, both its foreign
    keys, and `hindrances.photos_status`. **Run while linked to TEST-DB,
    not prod** — recorded explicitly rather than implied. Sound because
    both databases now carry 044 identically at the schema level, and
    `supabase gen types` output does not encode grants (the one axis on
    which the two databases deliberately differ) — so which database was
    linked for this specific step does not change the generated output.
11. **Reservations file updated, same session as the apply.**
    `scripts/migration-number-reservations.json`'s own `044` entry gains a
    dated correction recording the apply, matching every prior applied
    entry's own convention (026/034/035/039/040/041/042/043).

## The real-send size gate — closed, but the tool that closed it had never been run either

`scripts/verify-hindrance-email-attachments.ts` had been recorded, in an
earlier round of this same review package, as "written and ready" —
blocked only by missing credentials. **That description was never tested
and was wrong in a more basic way than "no credentials": the script
itself was broken and had never been executed once, in any mode.** Its
first real run (a `--dry-run` invocation, no send attempted) crashed
immediately — a JPEG segment's 16-bit length field cannot encode a 222 KB
payload the way the original generator wrote it. Fixed by chaining
multiple bounded segments instead of one oversized one. **A second bug
surfaced while proving the fix, the same way the first was found — by
running it, not by re-reading it**: the `--dry-run` argument parser
swallowed the photo-count argument as the (unused, in dry-run) `to`
address, so `--dry-run 1` and `--dry-run 10` both silently reported the
default count of 3. Both fixed and re-verified before this gate was
considered closed.

**The gate itself, closed by a real delivered send**: 3 attachments, 666
KB raw / 888 KB base64-encoded, delivered to Gmail, not clipped. At 10
photos, the same arithmetic scales to roughly 2.9 MB encoded — comfortably
inside Resend's own documented 40 MB per-email limit, verified live
against Resend's current docs (not recalled from training) earlier in
this review.

## Owed, not done — the closing artifact of this record

**No real hindrance report carrying photos has yet reached a PM's actual
inbox on prod.** The size/deliverability gate above proves the email
channel can carry attachments of this size without being clipped; it does
NOT prove the full, real, end-to-end path — an engineer reporting a
hindrance on a real handset, sending real photos through Q3, the
`hindrance_media_ingest` job actually uploading them, and
`handleHindrancePmNotifyJob` actually attaching and delivering them to a
real PM's mailbox — has ever run once, for real, on production.

~~**MARKED OWED, EXPLICITLY, NOT COMPLETE**: a manual, post-deploy check —
one real hindrance report, with at least one real photo, from a real
engineer on a real handset, against production — then confirm by direct
observation that the PM notification email actually arrived with the
photo attached and openable. This is the last piece of end-to-end proof
this feature needs before the whole path can be trusted on prod, and it
has NOT been performed. Whoever performs it should record the result as a
dated addendum to this file, in the same "struck through, not rewritten"
discipline the rest of this record follows.~~

**DATED (2026-09-15): Done — verified on prod earlier (real hindrance,
real photos, delivered to PM inbox).**

## What this apply does NOT include

**No application code changed in this pass.** This is documentation and
JSON only — the migration file's header correction, the reservations
file's dated correction, and this record (plus, mechanically, the file's
own move into `supabase/migrations/` and the regenerated
`types/database.ts`, both produced by the manual prod apply itself, not
authored in this pass). No `lib/`, `app/`, or test changes; no database
connection of any kind was made while producing any of it.

**Prod has not been re-verified a second time by this session.** Every
fact in the "Sequence followed" section above was reported from the apply
itself, run outside this session, and is pasted here verbatim — this
record did not re-run any probe against prod (or against test-db) to
confirm it.

**Not merged.** This record, the reservations correction, and the
migration-file promotion are committed to a branch and opened as a PR, per
this pass's own instructions — `main` does not carry them yet as of this
writing.
