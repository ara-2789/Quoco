# PR #348 (PR-D1, Material Inward PM page): code review, round 1

**Verdict: conditional GO for merge.** There are no blocking findings. Before merge: fix S1 and show it RED then GREEN, and the strings-only commit must pass the head check below. I could not reach the CI run, so the green result rests on your record until it is re-pinned.

## 1. Pins and scope

- Head `b854dde459d279f97e3d0c8a8d510bab76104090` (`refs/pull/348/head`). Base and merge-base are both `f536fe26cc9d9c6ac0fd5d4c2cbcd006b885be87`. 15 commits, 25 files, +4379/−3. No migration, and `supabase/` is untouched.
- **Read in full:**
  - `app/api/capture-files/[fileId]/route.ts`
  - `lib/capture/pm-file-access.ts`, `pm-queries.ts`, `pm-actions.ts`, `pm-errors.ts`
  - `app/(dashboard)/material-inward/actions.ts`, `page.tsx`, `[deliveryId]/page.tsx`
  - `components/material-inward/file-list.tsx`
  - the T-NOWRITE-1 diff in `test/capture-handler.test.ts`
  - the refusal and control blocks of `test/pm-file-route.test.ts`
- **Checked against base:** `lib/auth/is-project-pm.ts`, `lib/auth/profile-query.ts`, the 049 RLS policies (`:906-960`) and the 049 FKs.
- **Not verified:** CI run 41313702342. The GitHub API refused this session, so the 162/162 and T-CONC-1 results stay unconfirmed until you paste the run's `headSha` and conclusion.

## 2. Answers to what you asked

**1. File wall: holds, with one gap (S1).**

What I confirmed against the code:
- The order matches the header comment (`pm-file-access.ts:29-30`): UUID check, then `getUser`, then profile, then rate limit, then the RLS read (`:197-202`), then `appCheckCaptureFile` (`:111-123`), then the service-role sign (`:224-228`).
- Every exit, including the `catch`, returns `refusal()`, which is 404 with no body and both headers. The Sentry call carries only the error object.
- Tenant is compared against the profile, not the row (`:117`).
- The path must equal `${profile.tenant_id}/${project_id}/${document_id}/${id}` exactly (`:120`). A row with a valid prefix that points at another document's object is therefore refused.
- `file-list.tsx:35-41` renders a plain `<a>` with no `next/link`, so nothing prefetches the route or mints a URL during render. D3 holds.
- The env-swap control's three cases are present (`pm-file-route.test.ts:226-255`), with the positive control at `:257`.

**2. `pm-queries.ts:329` opt-out: confirmed safe, but the comment understates the guarantee.**
- `deliveries.reported_by` is a `users.id`, written by `050:330` as `p_user_id`. It is never an auth uid.
- The FK is not "plain": `deliveries_reported_by_fk FOREIGN KEY (reported_by, tenant_id) REFERENCES public.users (id, tenant_id)` (049, the deliveries DDL). That composite same-tenant FK is stronger than the comment says, and it is the fact that makes the `.eq('tenant_id')` filter redundant rather than load-bearing.
- The read selects `full_name` only, through the user client. The `users_select` policy (same tenant) allows it.
- Fix the comment so it states the composite FK (N1).

**3. `getDeliveryDetail` relying on RLS alone: accepted.**

The deciding question is who produces the output.
- The detail page returns rows read with the user's client. RLS is the policy that produces those rows, so RLS is the audience check, and 049 D-20 makes it the read authority.
- The file route is different. Its output is a URL minted by the service role, which bypasses RLS downstream. So its application check has to be complete on its own.

Same-tenant rows from another project are therefore correctly left to RLS in the detail page. Your control shows RLS is load-bearing there, and that is the correct finding for a read. It does not prove a second layer, and none is needed for a read. Record this ruling beside the deviation so nobody later reads the difference from the file route as drift.

**4. Server Actions: confirmed.**
- `actions.ts` exports only async functions that take form fields. `buildDeps` and `refresh` are not exported.
- All five writes are `deps.client.rpc(...)` calls to the 050 DEFINER functions, using the user's client. No service role appears in any action.
- Malformed browser input is handled:
  - a missing `loaded` or `next`, or a non-string field, throws inside `guarded` and comes back as `PM_ERR_SAVE_FAILED`
  - non-string ids fail `isUuid`
  - the database authorises every call (QE015)
- `settle` refuses to infer success: it requires the result to echo the id. That is the right posture.

**5. T-NOWRITE-1: still catches a new direct writer in `lib/` or `app/`, but not every new writer (S2, S3).**

What it catches:
- **A file on neither list.** It fails (a), because `mentioning().filter(f ∉ READERS)` must equal `C5_ALLOWED` exactly.
- **A write chain inside a reader.** Each `from('capture_files')` chain must contain `.select(` and no write verb. The file-wide `WRITE_CALLS` check backs that up, and `.update(...).select()` is still caught.
- **A name outside a `from(...)`.** Any variable, comment or template literal that names the table breaks the `accounted === total` count.
- **An RPC in a reader.** It fails (e2).

What it does not see:
- writers outside `lib/` and `app/`
- `.js`/`.mjs` files
- RPC writers in non-reader files
- the storage bucket

The last two mean the guard's true statement is narrower than its title. See S2 and S3.

**6. Known risks: accepted, with two notes.**
- **Stale-form check.** It compares against `loaded` values the client sends. That makes it a courtesy check for a stale tab, not a control. The code already says so (`pm-actions.ts:189-192`), and that is correct.
- **Null-kind tolerance.** Under 052 rev 6, an unclassified document has no delivery, and the composite FK makes a delivery on a kind-NULL document impossible. I showed that behaviourally in 052 round 2, T1. So PR-D1's null-kind branches in list and detail are unreachable by construction. They are harmless, but they are not what makes unclassified documents visible. PR-D2 needs a document-driven query, which is item (i) of the 052 C6 gate.

## 3. Findings

**S1. The file wall does not check `users.status`; only RLS does. This must land before merge.**
- *Mechanism.*
  - `profileForAuthId` selects `id, tenant_id, full_name, role`, with no status (`profile-query.ts:17`).
  - `isProjectPm` checks `project_members.role` only (`is-project-pm.ts:20-30`).
  - The module's own comment says it: "ACTIVE status relies on the RLS read in step 2" (`pm-file-access.ts:102-105`).
  - T-FILE-CTRL covers cross-tenant, cross-project and qs, but has no deactivated case (`pm-file-route.test.ts:225-266`). With `rowClient` swapped, a deactivated PM who still has a session JWT and a membership row would get the 302.
- *Why it matters.* By your own statement (Q1), this route is the only barrier in front of the bucket, and its output is minted by the service role. Status is the one audience fact the application check leaves out. Deactivation-only offboarding (§10a) makes "deactivated but still a member" the normal state for a departed PM, not an edge case.
- *Fix.* In `handleCaptureFileGet`, read `users.status` for `profile.id` with the session client. Refuse unless it is `'active'`. Pass it into `appCheckCaptureFile` so the pure check covers it. Do not change `profileForAuthId`; other callers depend on it.
- *Test.* Add `same swap, deactivated PM of A1: 404` to T-FILE-CTRL. Show it RED on `b854dde` with `PM_CONTROL=service`, then GREEN after the fix.

**S2. Nothing guards the bucket the way T-NOWRITE-1 guards the table.**
- *Mechanism.* There is no `storage.objects` policy, and `service_role` can remove or overwrite objects. `pm-file-access.ts` holds a service client with full storage access. A later `.remove([path])` or `.upload(..., {upsert: true})` in that file passes every T-NOWRITE-1 check, because the table string never appears and `WRITE_CALLS` does not list storage verbs.
- *Why it matters.* The 051 row immutability protects metadata. The bytes behind a `stored` row are the evidence, and only convention protects them.
- *Fix.* Add T-NOBUCKET-1:
  - the files that name `capture-documents` or a bucket constant are exactly `capture-ingest.ts` (writer: `upload`, `download`) and `pm-file-access.ts` (signer)
  - in the signer, every `.storage` chain calls only `createSignedUrl`
  - controls: a planted `.remove(`, `.upload(`, `.move(` and `.copy(` each turn it RED.

**S3. The guard's scope is narrower than its claim.**
- *Mechanism.*
  - `sourcesMentioning` walks `lib/` and `app/` only and matches `.ts`/`.tsx` (`capture-handler.test.ts:536-546`). It does not cover `components/` (where a `.tsx` can hold an inline `'use server'` action) or root files such as `proxy.ts`, and it skips `.js`/`.mjs`.
  - Separately, a direct writer that never names the table (an `.rpc` from any non-reader file, as `material-inward.ts` already does with `apply_material_inward_turn`) is invisible by design.
- *Fix.*
  - Extend the walk to the repo root, excluding `node_modules`, `.next`, `test/` and `docs/`, and add `js|mjs|cjs`.
  - Retitle the block to what it proves: "no direct `from('capture_files')` write outside C5." The real write boundary is the grant layer: `service_role` UPDATE on 7 columns (051), no INSERT/DELETE grants, and DEFINER-only inserts. Name that in the block comment so the test is not read as the control.
  - Control: an unlisted file under `components/` that mentions the table turns it RED.

**N1.** Correct the `pm-queries.ts:329-330` comment: the FK is composite `(reported_by, tenant_id) → users (id, tenant_id)`.

**N2. Two different facts share the name `receivedAt`.**
- `linkedInvoice.receivedAt` and the DC-page invoice candidates use `capture_documents.created_at` (`pm-queries.ts:459`, `:486`).
- The invoice-page candidates use `deliveries.received_at` (`:440`).
- Rename the first to `documentCreatedAt`. If 052 lands the document `received_at` column (052 round 2, B1), switch to that.

**N3.** `truncated` is computed before the null-kind filter (`:150-162` vs `:198`). A page can show fewer than 100 items and still say it is truncated. Today this cannot happen, but name it.

**N4.** `uuidList` silently drops non-UUID ids (`:284-286`). In an exclusion list, that turns a dropped id into an included candidate. Ids come from the database, so this is unreachable today. Throw instead of filtering, so a surprise fails loudly.

**N5.** `isRateLimited` never evicts expired entries (`pm-file-access.ts:62-71`). Growth is bounded by distinct PMs per warm instance, so it is negligible now. This is the same shape as the photo route.

**N6.** `runReject` checks `length > 1000` before `trim()` (`pm-actions.ts:238`). A 1001-character reason with trailing spaces is refused even though the database would accept the trimmed value.

## 4. Credit

- The order in `appCheckCaptureFile` puts the cheap, exact refusals (tenant against the profile, `stored`, exact path) before the membership query. The exact-path comparison closes the "valid prefix, someone else's object" case that the 051 CHECK permits.
- `resolveDownloadName` returns `null` for an unknown kind, and the route refuses instead of naming the file. "Never guess" is applied at the one place a guess would have been invisible.
- Splitting `actions.ts` from `pm-actions.ts` removes the injectable-client hazard structurally, instead of relying on reviewers to never add a `deps` parameter to a `'use server'` export.
- (e)'s `accounted === total` rule counts comments too. That closes the "a second mention hides a second use" class that (c) was tightened against in C5.
- `settle` requires the id echo, so a null, wrong-shaped or wrong-id result is `PM_ERR_SAVE_FAILED` plus Sentry, never a silent success.

## 5. Verdict

**Conditional GO for merge.** Merge is deploy, so these must hold first:

1. **S1** fixed. Show the T-FILE-CTRL deactivated case RED on `b854dde` and GREEN on the fix commit, with HEAD and file sha256 printed.
2. **The strings commit touches strings only.** `git diff --stat b854dde <new-head>` must show only `lib/capture/pm-copy.ts` (plus any string-pinning test). The `PM_ERR_MESSAGES` keys must be unchanged, and the T-NOWRITE-1 (e) count must hold.
3. **CI re-pinned** on the final head, with the run's `headSha` equal to the PR head. Paste the conclusion and the T-CONC-1 line, since I could not read run 41313702342 from here.
4. **S2 and S3** either land in this PR or are recorded in `docs/plans/pr-d-plan.md` as deferred, with an owner and the PR they go into. Tie them to the C6 gate: they must land before digit 4 goes live for anyone other than your number.

N1 to N6 can go in the strings commit or in PR-D2.
