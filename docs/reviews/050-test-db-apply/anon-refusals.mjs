import { createRequire } from 'node:module'
const require = createRequire('/Users/aravindanrajamani/Desktop/quocoai/package.json')
const { config } = require('dotenv')
const { createClient } = require('@supabase/supabase-js')
config({ path: '/Users/aravindanrajamani/Desktop/quocoai/.env.test', quiet: true })
const url = process.env.SUPABASE_TEST_URL
const host = new URL(url).host
if (!host.startsWith('exfccwlrhoutkgrlikod.')) { console.log('REFUSING: host is not test-db:', host); process.exit(2) }
const claimRef = (k) => JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString()).ref
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
if (claimRef(anonKey) !== 'exfccwlrhoutkgrlikod') { console.log('REFUSING: anon key claim is not test-db'); process.exit(2) }
console.log('TARGET CONFIRMED: host', host, '| anon key ref claim', claimRef(anonKey), '| role claim', JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64').toString()).role)
const anon = createClient(url, anonKey, { auth: { persistSession: false } })
const z = '00000000-0000-0000-0000-000000000000'
for (const [fn, args] of [
  ['pm_approve_delivery', { p_delivery_id: z }],
  ['apply_material_inward_turn', { p_phone_number: '+0', p_tenant_id: z, p_user_id: z, p_project_id: z, p_message: 'x', p_message_sid: 'x' }],
  ['expire_stale_material_inward', { p_phone_number: '+0' }],
]) {
  const r = await anon.rpc(fn, args)
  console.log(fn, '->', 'status', r.status, 'code', r.error?.code, '|', r.error?.message)
}
