# `generate-one-dpr.ts` defaults to prod — proposed fix, not implemented (J7c)

**Status: write-up/proposal only, per the governing instruction ("J7 is write-ups
only... No implementation"). No code has been changed.**

## The problem, found live this session

`scripts/generate-one-dpr.ts` hardcodes `config({ path: '.env.local' })` at line 24.
`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` is `https://jvxwqignooseazzmwhvl.supabase.co` —
**production.** The script takes exactly three positional arguments
(`<project_id> <engineer_id> <log_date>`) and has **no target/environment argument at
all** — there is no way to tell it "run against test-db" short of overriding the
underlying env vars from outside the script's own invocation.

This session needed to run the script against test-db for migration 029's Phase 5
rehearsal. The only way to do that safely was to pre-export
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `.env.test`'s
`SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY` values in the same shell invocation,
relying on the fact that `dotenv`'s `config()` does not overwrite an already-set
`process.env` variable. This worked, and was verified to actually work (a disposable
temp check script confirmed the redirected client really pointed at test-db before any
real write was attempted) — but it is a workaround that depends on knowing an
implementation detail of `dotenv`, not a supported invocation. **Anyone running this
script normally, without knowing that trick, writes to production by default, silently.**

`createServiceClient()` (`lib/supabase/service.ts`) reads exactly
`process.env.NEXT_PUBLIC_SUPABASE_URL!`/`process.env.SUPABASE_SERVICE_ROLE_KEY!` — same
names `.env.local` sets for prod, deliberately different from `.env.test`'s
`SUPABASE_TEST_*` names, so there is no accidental cross-talk in the normal case; the
risk is specifically that the script never asks which one it's using.

## Proposed fix (design only)

1. **Require an explicit target argument.** Change the CLI shape from
   `generate-one-dpr.ts <project_id> <engineer_id> <log_date>` to
   `generate-one-dpr.ts --target=<prod|test> <project_id> <engineer_id> <log_date>` (or a
   positional target as the first argument — either is fine, but it must be mandatory,
   not defaulted).
2. **Refuse to run without it.** If `--target` (or the positional equivalent) is missing
   or not one of the two recognized values, exit non-zero immediately with a clear error,
   before any env var is read or any client constructed. No default — "prod" must never
   be an implicit fallback.
3. **Resolve env vars from the target, not from a single hardcoded `.env.local` load.**
   `--target=test` loads `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY` (from
   `.env.test`, matching what the test suite itself already uses) and maps them into the
   same variable names `createServiceClient()` expects, in-process — the same mapping
   this session did manually from the shell, made a built-in, supported path instead of a
   trick. `--target=prod` loads `.env.local` as today.
4. **Print the resolved target and the resolved Supabase URL's host before any write.**
   e.g. `Target: test (https://exfccwlrhoutkgrlikod.supabase.co)` — a single line,
   printed unconditionally, so a human running this interactively sees exactly where a
   write is about to land before it happens. This mirrors the same discipline CLAUDE.md's
   own §0 already requires for prod applies ("the linked project ref is printed and
   pasted immediately before the apply, in the same output") — applying it here closes
   the same class of gap for this script that §0 already closes for migration applies.

## Scope check — is this script alone, or a pattern?

Checked whether any other script under `scripts/` shares this shape (hardcoded
`.env.local` load, DB-writing, no target argument), rather than assuming it's isolated:

- **`scripts/dump-golden-cases.ts`** also loads `config({ path: '.env.local' })`, but
  calls `callDprModel` (Anthropic API) directly — **no `createServiceClient()` call, no
  Supabase import, no DB read or write anywhere in the file.** It loads `.env.local`
  only for the Anthropic API key. This script does **not** share the risk;
  misdirecting it wouldn't misdirect a database write because it never makes one.

No other script matching this shape was found. **`generate-one-dpr.ts` is the only
script in this repo with the prod-default-plus-DB-write risk.**

## Not done here

No code changes were made to `generate-one-dpr.ts` — this document is the proposal only,
per the explicit "no implementation" instruction governing this round of write-ups.
Implementing it is a small, mechanical change (an argument parser addition and an env
var resolution branch) that can be picked up as its own scoped task when authorized.
