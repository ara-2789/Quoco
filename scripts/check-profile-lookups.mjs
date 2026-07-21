#!/usr/bin/env node
// Guardrail against reintroducing the pre-007 profile-lookup bug.
//
// WHY A GREP AND NOT A TEST: migration 007 backfills auth_id = id for every
// pre-007 account, so a lazily written `.from('users').eq('id', user.id)` still
// works for the developer and every EXISTING account — it breaks ONLY for users
// created AFTER 007 (generated id != auth uid). Dogfooding structurally cannot
// catch it; only a static check can. Resolve profiles via lib/auth/profile.ts
// (getProfile / profileForAuthId), which key on auth_id.
//
// Heuristic: fail if a file BOTH selects from('users') AND uses .eq('id', ...).
// lib/auth/profile.ts is the one allowed home for users lookups (and it uses
// auth_id, so it wouldn't match anyway — excluded belt-and-braces).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['app', 'lib']
const ALLOW = new Set(['lib/auth/profile.ts'])
const FROM_USERS = /from\(\s*['"]users['"]\s*\)/
const EQ_ID = /\.eq\(\s*['"]id['"]\s*,/

// Inline, per-file opt-out for a JUSTIFIED .eq('id', ...) — where the id is a
// resolved users.id (not an auth uid), so the pre-007 bug class cannot occur. A
// file carrying this tag is suppressed but STILL PRINTED below, so the exemption
// is auditable in the build log, never silent. This does NOT relax the
// FROM_USERS/EQ_ID detection — it only lets a reviewed call site opt out on the
// record. Keep the tag adjacent to the query it justifies.
const ALLOW_TAG = 'profile-lookup-guard:allow-id-eq'

const offenders = []
const suppressed = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return // root may not exist in some checkouts
  }
  for (const entry of entries) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      walk(p)
      continue
    }
    if (!/\.(ts|tsx)$/.test(p)) continue
    const rel = relative('.', p)
    if (ALLOW.has(rel)) continue
    const src = readFileSync(p, 'utf8')
    if (FROM_USERS.test(src) && EQ_ID.test(src)) {
      if (src.includes(ALLOW_TAG)) suppressed.push(rel)
      else offenders.push(rel)
    }
  }
}

for (const r of ROOTS) walk(r)

// Print every suppression so a justified exemption is auditable in the build
// log, never silent (a whole-file tag could otherwise mask a future real bug).
if (suppressed.length > 0) {
  console.log(
    `• profile-lookup guard: ${suppressed.length} file(s) opted out via ` +
      `"${ALLOW_TAG}" (reviewed .eq('id', ...) on a resolved users.id):`,
  )
  for (const s of suppressed) console.log('    ' + s)
}

if (offenders.length > 0) {
  console.error(
    "✗ profile-lookup guard: these files query from('users') with " +
      ".eq('id', ...) — post-007 that matches the auth uid against the " +
      'decoupled users.id and silently breaks for users created after 007.',
  )
  console.error('  Resolve profiles via lib/auth/profile.ts (keys on auth_id):')
  for (const o of offenders) console.error('    ' + o)
  process.exit(1)
}

console.log("✓ profile-lookup guard: no from('users') + .eq('id', ...) in app/ or lib/")
