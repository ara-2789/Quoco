# Migration 007 — Checkpoint 1 Review — Reviewer Feedback (Round 1)

> Verbatim feedback from the developer-friend Checkpoint 1 review of
> `docs/migration-007-checkpoint-1-review.md`. Preserved unedited as the
> project record of what shaped the revision. Do not paraphrase or trim.

---

Alright, I read the whole thing. Credit where due: this is a better-prepared migration doc than most I've reviewed professionally — the §3 audit tables and the honest R1–R6 list are exactly right. So I'm going to spend my time on what the document *doesn't* question, because that's where the danger is. In rough order of severity:

## 1. The plan never justifies the surgery itself

The entire doc assumes decoupling `users.id` from `auth.users.id` is the right move and only debates *how*. Challenge the *why*. Your actual requirement is: "engineers and owners need `users` rows without a web login." There are at least two designs that satisfy that without irreversible identity surgery:

**Option A — shadow auth users.** Your test fixture's `auth.admin.createUser()` "crutch" is arguably not a crutch — it's a legitimate pattern. Supabase happily creates auth users with a phone number and no password. Your engineers *have phone numbers* (they submit via WhatsApp!). If an engineer ever gets promoted to a web login later, you don't need a data migration — their identity already exists. You're about to do irreversible surgery partly to delete the one piece of code that was quietly pointing at the simpler design.

**Option B — split the table.** `users` today conflates three concepts: authentication identity, person/profile, and tenant membership. A `people` (or `participants`) table for non-login humans, keeping `users` strictly = "can authenticate," would leave the FK intact and make the domain model honest. Yes, `daily_logs.engineer_id` would FK to `people` — but you're rewriting that policy anyway.

Maybe you land on the current plan anyway — nullable `auth_id` is a common pattern and it's defensible. But a document this thorough should contain a paragraph titled "alternatives considered and rejected," and its absence makes me suspect the decision was inherited from `schema.md` rather than made.

## 2. Missing: `UNIQUE` and an index on `auth_id`. This is a correctness *and* scalability hole

Nowhere in §1a, §5, or the probes does the plan add a uniqueness constraint on `auth_id`. Without it:

- Two `users` rows can share an `auth_id`, and `get_user_tenant_id()` — the function every single RLS policy hangs off — becomes nondeterministic. One bug in `handle_new_user` or one manual insert, and a login silently resolves to an arbitrary row, potentially in the wrong tenant. That's your R2 cross-tenant nightmare with no policy bug required.
- Without an index, `WHERE auth_id = auth.uid()` is a sequential scan of `users`. Today the lookup rides the PK index for free. `get_user_tenant_id()` is evaluated on essentially every RLS-guarded query — this is the hottest lookup in your system and you're about to move it off an index. At 10 users you won't notice; at 10k users every dashboard query degrades.

Fix: `CREATE UNIQUE INDEX ... ON users(auth_id) WHERE auth_id IS NOT NULL` in step 1 or 2 of the transaction, and add "unique partial index exists" to the §5 probe table. While you're in there, verify `get_user_tenant_id()` is `STABLE` (and `SECURITY DEFINER` with a pinned `search_path`) so Postgres can plan it as an InitPlan instead of per-row.

## 3. `ON DELETE SET NULL` + the new `handle_new_user` is a duplicate-profile machine

Walk this lifecycle: an admin deletes a PM's auth account (offboarding, or the PM asks to). `SET NULL` fires — the `users` row survives with `auth_id = NULL`, now *indistinguishable* from an engineer who never had a login. Six months later the PM comes back and signs up with the same email. `handle_new_user` blindly inserts a **brand-new** `users` row. You now have two rows for one human: the old one owning all the `projects.created_by` and `project_members` history, and a new empty one that actually logs in.

Related and more immediate: what's your invitation flow? The common SaaS pattern is "admin creates the PM's profile, PM signs up later." With this trigger, that produces a duplicate on day one. `handle_new_user` needs an upsert/re-link strategy (match on email, `ON CONFLICT`, or an invitations table) — and honestly I'd challenge whether `SET NULL` is right at all versus `RESTRICT` plus an explicit offboarding procedure. Silent nulling of identity links is how audit trails die.

## 4. "Same PR" doesn't solve the deploy window — but your backfill accidentally does, so say it out loud

R3 hand-waves "app + 007 ship together," but a DB migration commits in one instant and a Vercel/whatever deploy takes minutes. Atomicity is impossible; what you need is an argument for why the window is safe. You actually *have* one and don't state it: because the backfill sets `auth_id = id`, **the old equality still holds for every pre-existing user**. Old app code doing `.eq('id', user.id)` keeps working post-007 for everyone already in the system. The only breakage in the window is a *brand-new signup* (generated `id ≠ auth.uid`), who'd hit a broken onboarding lookup until the new app code lands.

So the real plan is: apply 007 → deploy app immediately → accept (or block) signups in the ~minutes-long window. Write that reasoning into §4/R3. It also means "same PR" vs "tightly-sequenced deploy" (your Q2) matters less than knowing DB-first is the mandatory order — new app code against the old schema errors instantly on a nonexistent column, which is strictly worse.

## 5. You violate your own splitting principle with the role rename — and it's unaudited

The doc's core thesis is "007 = identity surgery and *nothing else*," then §1a.8 keeps `client → owner` inside 007. That's not identity surgery, it's a rename. Worse: §3 exhaustively audits `auth.uid()` usage but there is **no equivalent audit for the string `'client'`** — not in RLS policy role subqueries, not in the app (`role === 'client'` checks, TypeScript enums, badge labels, route guards). Either grep and produce the §3-style table, or move the rename to the corrections migration where its blast radius belongs. Right now it's the least-examined change in the riskiest migration.

## 6. The architecture question you should ask *before* surgery: one tenant per login, forever?

`tenant_id` lives on `users`, and `get_user_tenant_id()` returns a scalar. Combined with a (hopefully) unique `auth_id`, you've hardwired: one auth account ↔ one tenant. In construction, a QS or PM consulting across two builders is not exotic. If multi-tenant membership is ever on the roadmap, the fix is a `tenant_members` join table and a helper that returns a set — which rewrites *every* RLS policy again. You are, right now, rewriting the helper and eight policies anyway. This is the cheapest moment you will ever have to make that call. I'm not saying do it — YAGNI is a fair answer — but "we consciously accept single-tenancy per login" should be a line in this doc, not an accident of schema.

## 7. Process smells

The dashboard-SQL-Editor-then-`migration repair` dance worked for 013/014, but you're now doing it for your most dangerous migration, and it means prod state and your migration files are reconciled by hand under pressure. Two things: (a) the IPv6 problem is usually solvable by pointing the CLI at Supabase's session pooler connection string (it's IPv4) — worth 30 minutes of investigation before doing identity surgery through a browser textarea; (b) whatever you do, snapshot/PITR-checkpoint prod immediately before applying. R6 says "no true rollback" — a point-in-time restore *is* your rollback for the first few minutes, and the doc never mentions it. That's a glaring omission for an irreversible migration.

Also, one nuance on R6: it overstates irreversibility. The *access path* is fully reversible — since backfilled rows keep `auth_id = id`, you could point the functions/policies back at `id` and quarantine any standalone rows created since. Data-irreversible ≠ system-unrecoverable; write the "oh no" runbook accordingly.

## Smaller pokes

Your R1 probe "`auth_id IS NULL AND id IN (auth.users)`" — fine, but the simpler invariant at migration time is `auth_id IS NULL` count = 0, full stop, since the FK guarantees every current row has an auth counterpart. And on T-007-03: confirm your test harness actually executes as two distinct *user JWTs*, not the service role — an RLS isolation test run with the service key is green by definition and proves nothing.

## Your §8 questions, quickly

(1) Yes, split — but apply the principle honestly and evict the role rename too, or audit it. (2) DB-first is forced; "same PR" is fine but the deploy-order argument from point 4 is what actually matters. (3) Option (a), agreed — dead RLS code that silently denies is a trap. (4) Push `owner_user_id` out with the corrections, agreed. (5) 007→014 ordering is fine. (6) Your backfill assumption is sound *because the FK enforces it* — one more reason to run the backfill before the drop, which you already do.

Before you write any SQL, I'd want answers to: what's the invitation/offboarding story (point 3), and did you consciously reject shadow auth users (point 1)? Those two answers determine whether this migration is even the right migration.
