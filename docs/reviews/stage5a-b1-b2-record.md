# Stage 5a — B1/B2 apply record

Dated 2026-09-17, per Aravind. Every item below is tagged **observed**
(directly verified this pass) or **per Aravind** (reported by Aravind,
not independently re-verified in this pass).

---

## B1 (PR #292) — project-PM check, photo route, retire getSignedPhotoUrl

- External review: **GO** (verdict at head `ad5e0e7`,
  `docs/reviews/stage5a-review-verdict.md`). Observed (repo).
- CI green: https://github.com/ara-2789/Quoco/actions/runs/35226666465
  (head `ad5e0e7`). Per Aravind.
- Merge commit `f26b73a0d07b093033fa8d4cd1ea4a9bfcd261ea`, parents
  `c8e43d2c6b3eae066b95accebd97a47d7e8009a2` and
  `ad5e0e7cb1d7a3af30894af1ae2034d75c3de9bc` (two parents — a regular
  merge commit, not a squash). Observed (`git log`, this pass).
- No migration. Observed (repo — no new file under `supabase/migrations/`
  in PR #292's diff).

### Prod observation, `GET /api/photos/daily_log/54a6e5c6-0bbc-406b-b96e-74dbbd03b0bb` on `app.quoco.co.in`

- **A — `ar.rcpl@gmail.com` (PM on the photo's project, same tenant):**
  photo served (redirect to a Storage signed URL). Per Aravind; screenshot
  shows the signed-URL page, the redirect hop itself was not independently
  captured.
- **B — logged-out, Incognito:** HTTP 404. Observed (screenshot, address
  bar `app.quoco.co.in`).
- **D — `aravindanenator@gmail.com`, PM in a DIFFERENT tenant ("Ara con
  co", tenant `708c34a9-5139-4fb7-954a-5ad1992f2baa`; the photo's tenant
  is `adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0`):** HTTP 404. Per Aravind.
  Tenant membership observed via prod SQL.
- **C — `+smoke020` (logged in, `tenant_id` `NULL`):** not run on prod
  (Supabase email rate limit); superseded by D. The NULL-tenant case is
  covered on test-db (the boundary matrix and the route refusal test).
- **Same-tenant non-PM:** test-db only — no such prod login exists.

---

## B2 (PR #293) — shared DPR photo selector (D7)

- External review: **GO** (verdict at head `151a07d`). Observed (repo).
- CI green: https://github.com/ara-2789/Quoco/actions/runs/35241405407
  (head `151a07d`). Per Aravind.
- Merge commit `025bde40c87707d07b66af176d60f235844cb5df`, parents
  `f26b73a0d07b093033fa8d4cd1ea4a9bfcd261ea` and
  `151a07d0d017a2a591f4b9494a281077dbfe8de4` (two parents — a regular
  merge commit, not a squash). Observed (`git log`, this pass).
- No migration, no prod-visible change (pure refactor of
  `lib/dpr/select-photos.ts`, same public entry point). Observed (repo).
- Accepted behaviour change recorded in `lib/dpr/select-photos.ts`'s own
  header (the readiness check and the candidate selector now query
  `hindrances` separately, so a hindrance inserted in the gap between the
  two can contribute a photo the readiness check didn't see; accepted by
  Aravind 2026-09-17). Observed (repo).
- Reviewer's optional 017 check (cross-tenant `project_members` INSERT →
  `23503`): already covered, not duplicated —
  `test/migration-017.test.ts:167` (T-017-05) and `test/migration-017.test.ts:179`
  (T-017-06). Observed (repo).

---

## Stage 4 prod observation (handover's "still to verify")

The Owner DPR email for Speed Mechatronics, Thu 17 Sept (engineer Vikram
Rao) arrived with 3 photo attachments and no overflow line. Per Aravind
(screenshot).

- Attachment order evening before hindrance: confirmed per Aravind (the
  hindrance photo was last).
- Sentry: no `dpr-photo-attach` events in the last 24h. Observed (search,
  2026-09-17).
- The email's "Morning not applicable — not on site today" is correct:
  Vikram reported not on site that morning (per Aravind).

This closes the handover's Stage 4 "still to verify" item.
