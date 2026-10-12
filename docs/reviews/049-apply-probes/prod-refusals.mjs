// 049 post-apply refusal observation on PROD through PostgREST (runbook step D2).
// Same cases as block 2b's T-REFUSE sections A-C (test-db), re-pointed at prod.
// Section D (test-only helpers) is omitted: the helpers never exist on prod.
//
// Safety:
// - Reads keys from .env.local and never prints them. Prints the host and JWT claims only.
// - REFUSES to make any call unless the URL host and BOTH keys' JWT `ref` claims equal PROD_REF,
//   and the keys' `role` claims are anon / service_role. (048 prod record, section 4, same check.)
// - Every write is shaped so that even a wrongly granted call cannot write a row:
//   INSERT {} fails NOT NULL; UPDATE / DELETE target an impossible id.
//
// Run from the main checkout root:  node docs/reviews/049-apply-probes/prod-refusals.mjs
// Expected last line: RESULT PASS=28 FAIL=0
import { createRequire } from 'module'
const require = createRequire(process.cwd() + '/')
const { config } = require('dotenv'); config({ path: '.env.local', quiet: true })
const { createClient } = require('@supabase/supabase-js')

const PROD_REF = 'jvxwqignooseazzmwhvl'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function claims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')) }
  catch { return null }
}
function stop(msg) { console.log(`STOP: ${msg}. No call was made.`); process.exit(2) }

if (!url || !anonKey || !svcKey) stop('a required variable is missing from .env.local (names: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)')
const host = new URL(url).hostname
const ca = claims(anonKey), cs = claims(svcKey)
console.log(`host: ${host}`)
console.log(`anon key claims: ref=${ca?.ref} role=${ca?.role}   service key claims: ref=${cs?.ref} role=${cs?.role}`)
if (host !== `${PROD_REF}.supabase.co`) stop(`host is not ${PROD_REF}.supabase.co`)
if (ca?.ref !== PROD_REF || ca?.role !== 'anon') stop('anon key is not a prod anon JWT')
if (cs?.ref !== PROD_REF || cs?.role !== 'service_role') stop('service key is not a prod service_role JWT')
console.log(`TARGET CONFIRMED: ${PROD_REF} (prod)`)

const opts = { auth: { persistSession: false } }
const svc = createClient(url, svcKey, opts)
const anon = createClient(url, anonKey, opts)
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-0000000000ff'
const TABLES = ['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links']
let pass = 0, fail = 0
const show = (e) => `code=${e.code ?? '?'} message=${String(e.message ?? '').slice(0, 160)}`
function report(label, ok, extra) { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${label} -- ${extra}`) }
function refusal(label, res, okCodes) {
  const { data, error } = res
  if (!error) return report(label, false, `expected refusal ${okCodes.join('|')} but the call SUCCEEDED (data ${Array.isArray(data) ? 'length ' + data.length : String(data)})`)
  if (okCodes.includes(error.code)) return report(label, true, `refused: ${show(error)}`)
  return report(label, false, `refused for the wrong reason (expected ${okCodes.join('|')}): ${show(error)}`)
}

console.log(`started: ${new Date().toISOString()}`)
// A. anon, per table: 16
for (const t of TABLES) {
  refusal(`A anon SELECT ${t}`, await anon.from(t).select('*').limit(1), ['42501'])
  refusal(`A anon INSERT {} ${t}`, await anon.from(t).insert({}), ['42501'])
  refusal(`A anon UPDATE ${t}`, await anon.from(t).update({ id: IMPOSSIBLE_ID }).eq('id', IMPOSSIBLE_ID), ['42501'])
  refusal(`A anon DELETE ${t}`, await anon.from(t).delete().eq('id', IMPOSSIBLE_ID), ['42501'])
}
// B. service_role writes, per table: 12
for (const t of TABLES) {
  refusal(`B service_role INSERT {} ${t}`, await svc.from(t).insert({}), ['42501'])
  refusal(`B service_role UPDATE ${t}`, await svc.from(t).update({ id: IMPOSSIBLE_ID }).eq('id', IMPOSSIBLE_ID), ['42501'])
  refusal(`B service_role DELETE ${t}`, await svc.from(t).delete().eq('id', IMPOSSIBLE_ID), ['42501'])
}
// C. positive control: service_role SELECT succeeds and the tables are empty: 4 (not counted as refusals)
let controls = 0
for (const t of TABLES) {
  const { data, error } = await svc.from(t).select('*').limit(1)
  const ok = !error && Array.isArray(data) && data.length === 0
  if (ok) controls++
  console.log(`${ok ? 'OK' : 'CHECK'}: C service_role SELECT ${t} -- ${error ? 'error: ' + show(error) : 'array, length ' + data.length}`)
}
console.log(`finished: ${new Date().toISOString()}`)
console.log(`positive controls OK=${controls}/4`)
console.log(`RESULT PASS=${pass} FAIL=${fail}   (expected PASS = 16 + 12 = 28)`)
