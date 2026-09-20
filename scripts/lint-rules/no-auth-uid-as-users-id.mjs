// Rule `no-auth-uid-as-users-id` — the SQL half of scripts/check-profile-lookups.mjs.
//
// THE CLASS: identity resolved against the WRONG column. `auth.uid()` is the
// Supabase AUTH user id. Since migration 007 it is only ever comparable to
// `users.auth_id` — never `users.id`, and never a `<something>_id` column such
// as `daily_logs.engineer_id` (which holds a `users.id`). This shipped once in
// SQL (002_rls_policies.sql:122 and 13 more lines) and was fixed by 007;
// check-profile-lookups.mjs only walks app/ and lib/ .ts/.tsx, so nothing
// linted SQL until this rule. Spec: docs/plans/add-engineer-plan.md §4.10 (S1,
// D16, rev12 N1/N2).
//
// LIVES IN ITS OWN MODULE, NOT INSIDE lint-migrations.mjs, because that file
// ends in an unconditional `main()` call and so cannot be imported by a test.
// Guarding `main()` instead would mean a wrong guard comparison silently
// stops the whole migration lint from running while CI stays green; keeping
// the rule here leaves `main()` untouched and that failure impossible.
//
// DETECTOR — per `;`-separated statement of comment-stripped SQL, at most one
// violation. `AUTH_UID` matches both `auth.uid()` and the Supabase RLS
// performance idiom `(SELECT auth.uid())`.
//
//   FWD     id = AUTH_UID                      \  only when the statement
//   REV     AUTH_UID = [alias.]id              /  mentions the users table
//   COL     <x>_id = AUTH_UID                  \  no `users` condition: the
//   COLREV  AUTH_UID = [alias.]<x>_id          /  daily_logs statements never mention it
//
// `auth_id` is the CORRECT column and is excluded from COL/COLREV; the
// look-behind on FWD (and the anchoring after `=` on REV) is what keeps
// `auth_id` / `engineer_id` / `tenant_id` from matching the bare-`id` forms.
//
// NOT MATCHED, stated so a reader doesn't assume more coverage than exists:
// IS NOT DISTINCT FROM, <>, IN (...), casts (`id::text = auth.uid()::text`),
// and columns not named `id` / `<x>_id` (e.g. `created_by`).
//
// `;`-splitting also cuts a PL/pgSQL `$$...$$` body at each internal `;`, so a
// hit in any statement after the first inside a function has no CREATE header
// in its fragment and is keyed `L<line>` rather than the function's name.
// Acceptable: exceptions exist only for LIVE, never-edited files whose line
// numbers cannot move (CLAUDE.md §6); a hit in a new or held file is a defect
// to fix, not to except.

export const RULE_NAME = 'no-auth-uid-as-users-id'

const AUTH_UID = String.raw`(?:auth\.uid\(\)|\(\s*SELECT\s+auth\.uid\(\)\s*\))`
const ALIAS = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*\.)?`
const NOT_IDENT = String.raw`(?![A-Za-z0-9_])`
// `<x>_id` other than auth_id itself (`auth_identity_id` is a different column).
const COL_ID = String.raw`(?!auth_id${NOT_IDENT})[a-z0-9_]+_id`

const PATTERNS = {
  FWD: new RegExp(String.raw`(?<![A-Za-z0-9_])id\s*=\s*${AUTH_UID}`, 'gi'),
  REV: new RegExp(String.raw`${AUTH_UID}\s*=\s*${ALIAS}id${NOT_IDENT}`, 'gi'),
  COL: new RegExp(String.raw`(?<![A-Za-z0-9_])${COL_ID}\s*=\s*${AUTH_UID}`, 'gi'),
  COLREV: new RegExp(String.raw`${AUTH_UID}\s*=\s*${ALIAS}${COL_ID}${NOT_IDENT}`, 'gi'),
}
// Which patterns need the statement to mention the users table.
const NEEDS_USERS = new Set(['FWD', 'REV'])

const MENTIONS_USERS = /\b(?:FROM|JOIN|ON|UPDATE|INTO)\s+(?:public\.)?users\b/i
const POLICY_NAME = /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z0-9_]+)/i
const FUNCTION_NAME = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)/i

function lineOf(sql, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (sql.charCodeAt(i) === 10) line++
  return line
}

function objectKey(stmt, firstLine) {
  const policy = POLICY_NAME.exec(stmt)
  if (policy) return policy[1].replace(/^"|"$/g, '')
  const fn = FUNCTION_NAME.exec(stmt)
  if (fn) return fn[1].split('.').pop().replace(/^"|"$/g, '')
  return `L${firstLine}`
}

// `sql` may be raw or already comment-stripped: stripping `-- ...` is
// idempotent and keeps newlines, so line numbers stay true either way.
export function ruleNoAuthUidAsUsersId(file, sql) {
  const stripped = sql.replace(/--[^\n]*/g, '')
  const violations = []
  let offset = 0
  for (const stmt of stripped.split(';')) {
    const stmtOffset = offset
    offset += stmt.length + 1
    const usesUsers = MENTIONS_USERS.test(stmt)
    const lines = new Set()
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (NEEDS_USERS.has(name) && !usesUsers) continue
      for (const m of stmt.matchAll(re)) lines.add(lineOf(stripped, stmtOffset + m.index))
    }
    if (lines.size === 0) continue
    const sorted = [...lines].sort((a, b) => a - b)
    violations.push({ file, object: objectKey(stmt, sorted[0]), rule: RULE_NAME, lines: sorted })
  }
  return violations
}
