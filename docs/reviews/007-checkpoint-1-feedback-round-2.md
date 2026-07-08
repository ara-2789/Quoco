# Migration 007 — Checkpoint 1 Review — Reviewer Feedback (Round 2)

> Verbatim feedback from the developer-friend Checkpoint 1 review, round 2, of the
> revised `docs/migration-007-checkpoint-1-review.md`. Reproduced unedited — this
> is his actual message. Verdict: "Fix 1–4, fold in 5, and this is APPROVED
> without another full round."

---

Read it end to end, and verified the one external claim myself rather than trusting it — the Supabase citation is accurate: MAU is a distinct count of user ids with an auth event (login, token refresh, etc.) in the billing cycle, so dormant shadow rows genuinely cost nothing, and the Pro quota and overage rate check out too. Good — the doc didn't fabricate its load-bearing fact. Supabase

Overall: this revision did the hard thing right. §0 honestly strengthened the case against its own plan, and §10 surfaced a real discovery (no users.email column) instead of papering over it. But that discovery created an internal contradiction, one instruction from the prompt was silently dropped, and the RESTRICT fix only half-closes the hole it was meant to close. Not approved yet — here's what stands between this and APPROVED, in order:

1. Point 6 was dropped: the single-tenant-per-login decision is nowhere in the document

The prompt required a "consciously accepted constraints" entry: single-tenant-per-login accepted for Phase 1, recorded as deliberate, with the note that this is the cheapest moment to change it and later change costs a tenant_members table plus a full RLS helper rewrite. I searched the revision — it's absent. The revision note at the top lists every other round-1 fix and conspicuously skips point 6, and §9 sits there as "RESERVED," which is probably where it was supposed to live. This is exactly the failure mode of agent-driven revisions — silent instruction loss — and it's why the diff-review gate exists. Add it (§9 is the natural home) before anything else.

2. Internal contradiction: T-007-05 tests behavior that §10b just deferred

§10b correctly concludes that with no users.email column and no invitation flow, handle_new_user "should keep inserting a fresh stub for now" and the re-link is "future work landing with invitations." But §6 still lists T-007-05 — the re-link test — in the 007 green-gate before prod. As written, the gate can never go green, or worse, someone "fixes" it by hacking a re-link in without the invitation infrastructure it depends on. Move T-007-05 out of the 007 gate and attach it to the invitations deliverable, keeping the spec exactly as written (verified-email condition included). T-007-04's "with no matching pre-created profile" qualifier is now vacuous at 007 time — harmless, but note it becomes meaningful only post-invitations.

3. The duplicate-profile machine is only half-closed, and §10a doesn't admit it

RESTRICT kills the accidental path — good, and I agree with the choice, so no counter-argument owed there. But §10a still blesses a "deliberate secondary flow" that nulls auth_id then deletes the auth row. Walk that flow with the re-link deferred: deliberately offboard a PM → auth_id = NULL row → PM returns and signs up → handle_new_user blind-inserts a stub → duplicate. The machine still runs; you've just made it require intent to start. The fix is one sentence of policy: until the re-link ships with invitations, the deliberate auth-deletion flow must not be built or used — deactivation is the only offboarding. Right now §10a describes a flow that §10b's finding makes unsafe, and nothing connects the two.

4. Probe gap: nothing verifies the new FK exists

The probe table checks the old FK is gone and the unique index is present — but never that auth_id's FK to auth.users exists with delete rule confdeltype = 'r'. That matters because of a footgun in step 1: ADD COLUMN IF NOT EXISTS ... REFERENCES ... is all-or-nothing — if the column already exists from a partial rerun without its FK, the entire clause no-ops and the FK is silently never created. Add a probe querying pg_constraint for the auth_id FK with confdeltype = 'r'. Cheap, and it closes the one idempotency hole in an otherwise well-guarded sequence.

5. §0 asked me to decide, so: (c), endorsed — and here are two costs of (a) the comparison missed

Both push the same direction, so they firm up rather than reopen the call:

Under (a), the trigger gets more complex, not less. on_auth_user_created fires on auth.admin.createUser() too — every shadow-engineer creation would fire handle_new_user, which would insert a users row racing the ENG-01 insert that provoked it. (a)'s claimed advantage of "no trigger changes" is false; it needs the trigger to distinguish real signups from shadow provisioning, which is uglier logic than anything (c) requires.

Supabase enforces phone uniqueness globally in auth.users. An engineer working for two builders — two tenants, same phone — is unremarkable in construction and impossible to model as two shadow users. Under (c) it's just two rows. (Adjacent flag, not 007's problem: uq_whatsapp_sessions_phone_number from 012 creates the same collision one layer up — worth a line in the known-issues list, because the inbound webhook resolving a phone shared across tenants is a routing question you'll face regardless of this migration.)

With the billing objection verified away, these two are what break the "near-tie" cleanly in (c)'s favor. Record them in §0 and the decision stops being a judgment call and becomes an argued one.

Smaller

The role 'owner' now has a dangling dependency: §1a.1 says auth_id is NULL for "engineer and owner," but owner won't exist in the CHECK constraint until the corrections migration ships the rename. 007 itself never inserts an owner so it's unaffected, but any owner-creation feature now has the corrections migration as a prerequisite — one sequencing sentence in §1b prevents a confusing CHECK violation later. And the header references only the Round 1 feedback file; the prompt asked for a Round 2 record file created and referenced too — confirm Claude Code actually created 007-checkpoint-1-feedback-round-2.md, since I can't see the repo.

Verdict

Fix 1–4, fold in 5, and this is APPROVED without another full round — none of the remaining items touch the core design, which is now sound and, more importantly, argued. The revision also passed the test I actually cared about: when the honest comparison and the email audit produced findings inconvenient to the plan, the document reported them instead of smoothing them over. That's the property that makes the rest of this trustworthy.
