# P2 — CI gates: stage 1 evidence

Process-hardening work order's P2, stage 1 (typecheck/lint/test). Not a
migration — no schema change, no prod apply, so this is a lighter record
than the 017–022 series, per the P2 design decisions: what matters here is
the two pieces of evidence a config file's own existence can't prove by
itself — that it actually runs, and that it actually catches something.

- Workflow: `.github/workflows/ci.yml`, `.nvmrc` (Node 24, confirmed
  against Vercel → Settings → Build and Deployment → Node.js Version, not
  guessed)
- PR: [#27](https://github.com/ara-2789/Quoco/pull/27) — **open, not yet
  merged** as of this writing. Held deliberately until this evidence
  existed (P2 design decision 4: non-blocking to start, then a separate,
  dated flip to required — wire it, verify it, then lean on it, matching
  this project's PITR/Sentry precedent).
- Branch protection: **not yet enabled.** This workflow reports on every
  PR/push but cannot block a merge until that's turned on as its own
  explicit step, after this evidence and after #27 merges.

---

## 1. The workflow runs, and ran correctly the first time

First real run, on PR #27 itself (the same PR that added the workflow —
GitHub schedules a new workflow file against the PR that introduces it):

| Job | Result | Run |
|---|---|---|
| Typecheck | pass (31s) | `https://github.com/ara-2789/Quoco/actions/runs/31162360624/job/92815363478` |
| Lint | pass (37s) | `https://github.com/ara-2789/Quoco/actions/runs/31162360624/job/92815363549` |
| Test | **fail** (26s) | `https://github.com/ara-2789/Quoco/actions/runs/31162360624/job/92815363630` |

The `test` job failure was `test/setup/guard.ts`'s own hard-abort, not a
workflow bug:

```
Error: [guard] ABORT: .env.test is missing SUPABASE_TEST_URL,
SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ANON_KEY, or
SUPABASE_TEST_PROJECT_REF. Refusing to run.
  at Object.guard [as setup] test/setup/guard.ts:13:11
```

The six repository secrets (`SUPABASE_TEST_URL`,
`SUPABASE_TEST_SERVICE_ROLE_KEY`, `SUPABASE_TEST_ANON_KEY`,
`SUPABASE_TEST_PROJECT_REF`, `TWILIO_AUTH_TOKEN`, `NEXT_PUBLIC_APP_URL`)
didn't exist in CI yet at that point — the guard correctly refused to run
rather than limp forward, which is itself a working proof of the guard in
a CI context, not only a local one. Once the secrets were added and the
same job re-run with **zero file changes**:

| Job | Result | Run |
|---|---|---|
| Test | **pass** (5m5s) | `https://github.com/ara-2789/Quoco/actions/runs/31162360624/job/92817095109` |

Worth stating plainly: the workflow was correct all along. The only
missing piece was repository configuration (the secrets), not the YAML.

---

## 2. Acceptance criterion — a deliberately-bad throwaway PR, RED then GREEN

Per the work order: a config file that has only ever been observed
*failing for a missing secret* proves the guard fires, not that the gates
catch a real defect. This section is that second, separate proof.

**Target: stage 1's `lint` job specifically** — the rule the work order
named by name ("no `any` under any circumstances — make that enforceable"),
and the fastest job to cycle (~30s vs. the `test` job's ~5min), so red→fix→green
could be observed twice as fast as picking a test failure and without
needing stage 2 (the migration linter) to exist first. Each stage proves
itself when it lands, rather than waiting on the next one.

**Mechanics note, not part of the proof itself:** the throwaway branch
(`ci/p2-acceptance-probe`) had to be built on top of `ci/p2-stage1-workflow`
(#27), not bare `main` — a PR off bare `main` has no workflow file in its
tree yet (since #27 is unmerged), so GitHub has nothing to schedule at all.
First attempt confirmed this the hard way: zero runs were created
(`gh run list` returned nothing) until the branch was rebuilt on top of
#27's tree. Recorded so this isn't rediscovered next time an unmerged
workflow needs proving.

**PR: [#29](https://github.com/ara-2789/Quoco/pull/29) (closed, never
merged — throwaway).** Deliberate violation:
`scripts/zz-ci-acceptance-probe.ts`, `const x: any = 1`.

### RED

| Job | Result | Run |
|---|---|---|
| Typecheck | pass (28s) | `https://github.com/ara-2789/Quoco/actions/runs/31163870696/job/92820140374` |
| Lint | **fail** (31s) | `https://github.com/ara-2789/Quoco/actions/runs/31163870696/job/92820140266` |
| Test | pass (7m0s) | `https://github.com/ara-2789/Quoco/actions/runs/31163870696/job/92820140406` |

Isolated correctly — only `lint` failed on this run, `typecheck` and `test`
both passed, so the red is attributable to the one deliberate violation,
not an incidental break. Log, confirming it's `no-explicit-any` specifically:

```
/home/runner/work/Quoco/Quoco/scripts/zz-ci-acceptance-probe.ts
##[warning]  5:7   warning  'x' is assigned a value but never used    @typescript-eslint/no-unused-vars
##[error]  5:10  error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 4 problems (1 error, 3 warnings)
##[error]Process completed with exit code 1.
```

(The other 3 warnings are the pre-existing, unrelated `no-unused-vars`
warnings already known from #26's era — not new, not errors, don't affect
the exit code.)

### GREEN

Same branch, same file, `any` → `number`:

| Job | Result | Run |
|---|---|---|
| Typecheck | pass (24s) | `https://github.com/ara-2789/Quoco/actions/runs/31164459499/job/92822009205` |
| Lint | **pass** (27s) | `https://github.com/ara-2789/Quoco/actions/runs/31164459499/job/92822009152` |
| Test | pass | `https://github.com/ara-2789/Quoco/actions/runs/31164459499/job/92822009367` |

Same log, for symmetry with the RED excerpt above — `no-explicit-any` is
gone, only the same 3 pre-existing unrelated warnings remain:

```
/home/runner/work/Quoco/Quoco/scripts/zz-ci-acceptance-probe.ts
##[warning]  5:7  warning  'x' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 3 problems (0 errors, 3 warnings)
```

PR #29 closed without merging — it was only ever a throwaway probe.

**Acceptance criterion satisfied:** the same rule, on the same file, on the
same branch, observed failing for the right reason and then passing after
the fix. Not asserted — both run URLs above are independently checkable.

---

## 3. Stage 2 (migration linter) — investigation findings, captured

Not yet built. This section exists because the investigation that will
inform it produced real, checked-against-the-repo numbers that a
conversation doesn't preserve — recorded here so that work doesn't have to
be redone before stage 2 actually gets written.

**A throwaway probe script (not committed) ran rough versions of the six
proposed rules against all of `supabase/migrations/001-022`, then every
non-obvious hit was hand-verified against the actual SQL — because two of
the probe's own regexes turned out to be wrong**, caught only by checking:
a comma in `DECIMAL(12,2)` truncated the type-capture regex to `DECIMAL(12`
before comparison (3 false positives — `contract_value`, `estimated_value`,
`gross_amount` are all already correctly `DECIMAL(12,2)`), and a bare
substring match on `value` caught `old_value`/`new_value`/`p_new_value`/
`v_old_value` in migration 019 — JSONB audit-log fields, not money (4 more
false positives). A third bug (a fixed-character-window search for
`SECURITY DEFINER` catching the *next* function's declaration in the same
file) produced one false positive in Rule 1 (`quoco_same_ist_day`, which
turned out not to be `SECURITY DEFINER` at all). None of these would
survive into a properly written `scripts/lint-migrations.ts` — recorded so
the real implementation doesn't reintroduce them.

**Verified count, by rule:**

| Rule | Verified violations |
|---|---|
| 1. `SECURITY DEFINER`, no same-file `REVOKE`+`GRANT` | 12 |
| 2. `CREATE TABLE`, no `tenant_id` | 5 |
| 3. `CREATE TABLE`, no same-file RLS enable | 24 |
| 4. Money-ish column, not `DECIMAL(12,2)` | 7 |
| 5. `CREATE TYPE ... AS ENUM` / status not TEXT+CHECK | 2 |
| 6. Duplicate numeric prefixes | 0 |
| **Total** | **50** |

**The shape that actually matters: 50 entries, 7 distinct reasons — mechanical
expansion, not 50 separate judgments.** (Corrected from "six" in the original
in-conversation summary of this investigation — that count itself undercounted,
missing rule 5's cluster and `tenants`' self-reference; the number below is
checked against the table above, not re-approximated.)

1. **020's later hardening** (Rule 1, 12 entries) — every one of these
   functions was created in 001–018, before migration 020 REVOKEd PUBLIC
   and GRANTed `service_role` explicitly. The ACL fix legitimately lives in
   020's own file, not the file that created the function.
2. **The 001/002 schema-then-RLS-policy split** (Rule 3, 22 entries) —
   `001_core_schema.sql` creates every table with zero `ENABLE ROW LEVEL
   SECURITY` statements; `002_rls_policies.sql` enables RLS on exactly
   those 22 tables (`grep -c` confirms 22 there, 0 in 001). One deliberate
   design, one shared reason.
3. **`jobs` / `processed_messages` — TRACKED GAP, not verified-safe**
   (Rules 2 and 3, 4 entries: no `tenant_id`, no same-file RLS, on both
   tables). Deliberately NOT the same class of exception as the other five
   — this is open debt, not a design decision that was checked and found
   fine. See below for the asymmetry between these two tables that's worth
   knowing before the exceptions file gets written.
4. **The two exceptions named at the start of this investigation** (Rules
   2 and 4, 3 entries) — `rate_catalog`/`rate_catalog_history` (Quoco-owned,
   legitimately tenant-less) and `tenants.annual_turnover DECIMAL(15,2)`
   (legitimately wider precision than the standard).
5. **`tenants` itself — self-referential** (Rule 2, 1 entry) — it *is* the
   tenant; nothing for it to reference. Self-evident, not named going in,
   found during verification.
6. **Phase-2 rate-precision mismatches** (Rule 4, 6 entries) — `final_rate`,
   `source_rate`, `adjusted_base_rate`, `suggested_rate`, `base_rate`,
   `recorded_rate` in the not-yet-built `rate_catalog`/BOQ tables are
   `DECIMAL(10,2)`, not `DECIMAL(12,2)` as CLAUDE.md's coding rule requires
   with "no exceptions."
7. **Phase-2 status-without-CHECK** (Rule 5, 2 entries) — `processing_status`,
   `pricing_status`, both bare `TEXT` with no nearby `CHECK`, both in
   not-yet-built Tender/BOQ stub tables.

**Two findings that weren't on anyone's radar going in:**

- **`jobs` and `processed_messages` genuinely lack `tenant_id`** — but the
  two tables are NOT symmetric, and that asymmetry is itself the finding.
  `processed_messages` already has a documented deviation note in
  `docs/schema.md`: *"NO tenant_id — a deviation from CLAUDE.md §4's
  every-table rule... Recorded as an observation, not a blessing; whether
  it should be tenant-scoped is an open decision, not something this doc
  settles."* `jobs` has **no equivalent note anywhere** — checked directly
  (no `### jobs` heading in `schema.md`, only a migration-changelog-style
  mention with no deviation note). So `processed_messages`'s eventual
  exceptions-file entry can cite an existing record; `jobs`'s cannot —
  it needs its own small doc fix at some point, not a citation that
  doesn't exist yet.
- **Exceptions must be keyed as narrow `(file, object, rule)` triples,
  never file-wide or rule-wide.** A reason like *"020 hardened these"*
  attached to a whole file or a whole rule would silently pass a **new**
  `SECURITY DEFINER` function added to an old, already-exempted file — the
  exact class of gap this linter exists to close. Keyed as
  `(012_whatsapp_session_transition.sql, acquire_and_transition_session,
  rule-1)`, it doesn't. This is the design decision that determines whether
  the exceptions file protects the codebase or quietly defeats the linter —
  its granularity matters more than its length.

---

## 4. Known follow-up, not urgent, not part of this PR's scope

**`actions/checkout@v4` / `actions/setup-node@v4` deprecation.** Every run
in this document carries this warning:

```
Node 20 is being deprecated. This workflow is running with Node 24 by
default. If you need to temporarily use Node 20, you can set the
ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true environment variable.
```

Both actions target Node 20 internally (unrelated to this repo's own
`.nvmrc`/Node 24 — this is about the action runtime, not the project
runtime) and GitHub is currently forcing them onto Node 24 runners as a
grace period. Not a failure today. Will become one once that grace period
ends. Bumping both to `@v5` clears it — recorded here so it's fixed
deliberately later, not rediscovered cold from a CI log when it starts
failing for real.

---

## 5. Status / next steps

- [x] Stage 1 workflow lands, runs correctly (§1).
- [x] Acceptance criterion — RED then GREEN, both pinned (§2).
- [ ] Merge PR #27.
- [ ] Enable branch protection requiring `typecheck` / `lint` / `test` —
      its own explicit, dated step, not a side effect of merging #27.
- [ ] Stage 2 (migration linter) — investigation findings captured (§3);
      not yet built.
- [ ] Stage 3 (types-drift check, test-db-scoped per the P2 design
      decisions) — not yet built.
- [ ] `actions/*@v5` bump (§3) — not urgent, tracked here.
