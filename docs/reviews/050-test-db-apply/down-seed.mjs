// DOWN rehearsal seed / check / cleanup on TEST-DB ONLY. Refuses unless the host and both key claims are test-db. Keys are never printed.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
const require = createRequire('/Users/aravindanrajamani/Desktop/quocoai/package.json')
const { config } = require('dotenv')
const { createClient } = require('@supabase/supabase-js')
config({ path: '/Users/aravindanrajamani/Desktop/quocoai/.env.test', quiet: true })
const REF = 'exfccwlrhoutkgrlikod'
const url = process.env.SUPABASE_TEST_URL
if (new URL(url).host !== `${REF}.supabase.co`) { console.log('REFUSING: host is not test-db'); process.exit(2) }
const claim = (k) => JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString())
const svcKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
if (claim(svcKey).ref !== REF || claim(svcKey).role !== 'service_role') { console.log('REFUSING: service key claim is not test-db service_role'); process.exit(2) }
console.log('TARGET CONFIRMED: host', new URL(url).host, '| key ref claim', claim(svcKey).ref, '| role', claim(svcKey).role)
const svc = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } })
const STATE = '/tmp/quoco/down-state.json'
const mode = process.argv[2]
const must = (r, what) => { if (r.error) { console.log('FAILED', what, r.error.code, r.error.message); process.exit(1) } return r.data }
const turn = async (st, phone, msg, sid, o = {}) => {
  must(await svc.from('processed_messages').insert({ message_sid: sid }), 'processed_messages ' + sid)
  return must(await svc.rpc('apply_material_inward_turn', { p_phone_number: phone, p_tenant_id: st.tenant, p_user_id: st.eng, p_project_id: st.project, p_message: msg, p_message_sid: sid, p_media: o.media ?? null, p_start_flow: o.start ?? false }), 'apply_material_inward_turn ' + sid)
}
if (mode === 'seed') {
  const run = randomUUID()
  const st = { run, tenant: randomUUID(), project: randomUUID(), eng: null, phoneInFlight: `+19995553${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`, phoneFlag: `+19995553${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`, sidPrefix: `ZZTestCapture-down-${run}-` }
  must(await svc.from('tenants').insert({ id: st.tenant, name: `ZZTestCapture-down-${run}`, slug: `zz-test-capture-down-${run}` }), 'tenant')
  must(await svc.from('projects').insert({ id: st.project, tenant_id: st.tenant, name: `ZZTestCapture-down-${run}-P` }), 'project')
  const u = must(await svc.from('users').insert({ tenant_id: st.tenant, role: 'engineer', status: 'active', full_name: `ZZTestCapture-down-${run}-eng` }).select('id').single(), 'engineer')
  st.eng = u.id
  must(await svc.from('project_members').insert({ tenant_id: st.tenant, project_id: st.project, user_id: st.eng, role: 'engineer' }), 'membership')
  fs.writeFileSync(STATE, JSON.stringify(st))
  const a = await turn(st, st.phoneInFlight, '4', st.sidPrefix + 's0', { start: true })
  const b = await turn(st, st.phoneInFlight, '1', st.sidPrefix + 's1')
  const c = await turn(st, st.phoneInFlight, null, st.sidPrefix + 's2', { media: [{ index: 0, content_type: 'image/jpeg', url: 'https://example.invalid/m/0' }] })
  console.log('in-flight engineer: start ->', a.outcome, '| kind ->', b.outcome, '| file ->', c.outcome, 'step', c.current_step)
  must(await svc.from('whatsapp_sessions').insert({ phone_number: st.phoneFlag, tenant_id: st.tenant, user_id: st.eng, current_flow: 'morning', current_step: 1, context: { invoice_reset_guard: 'morning' }, pending_flows: [], expires_at: new Date(Date.now() + 20 * 60e3).toISOString(), updated_at: new Date().toISOString() }), 'flag session')
  const d = await turn(st, st.phoneInFlight, null, st.sidPrefix + 's2b', { media: [{ index: 0, content_type: 'image/jpeg', url: 'https://example.invalid/m/1' }] })
  console.log('"a turn works" (a further file at S3) ->', d.outcome, 'step', d.current_step)
  console.log('seeded under tenant', st.tenant, '(slug zz-test-capture-down-<run>)')
} else if (mode === 'after') {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  const rows = must(await svc.from('whatsapp_sessions').select('phone_number,current_flow,current_step,context').in('phone_number', [st.phoneInFlight, st.phoneFlag]), 'sessions')
  for (const r of rows) console.log('session', r.phone_number === st.phoneInFlight ? 'in-flight' : 'flag', r.current_flow, r.current_step, JSON.stringify(r.context))
  const docs = must(await svc.from('capture_documents').select('id').eq('tenant_id', st.tenant), 'docs')
  console.log('capture_documents left under the seed tenant (049 data is untouched by the DOWN):', docs.length)
  const m = must(await svc.rpc('apply_morning_flow_turn', { p_phone_number: st.phoneInFlight, p_tenant_id: st.tenant, p_user_id: st.eng, p_project_id: st.project, p_message: '', p_start_flow: true }), 'morning start')
  console.log('morning start for the seeded engineer ->', JSON.stringify(m))
  const gone = await svc.rpc('apply_material_inward_turn', { p_phone_number: st.phoneInFlight, p_tenant_id: st.tenant, p_user_id: st.eng, p_project_id: st.project, p_message: 'x', p_message_sid: st.sidPrefix + 'after' })
  console.log('apply_material_inward_turn after the DOWN ->', gone.error?.code, '|', gone.error?.message?.slice(0, 80))
} else if (mode === 'cleanup') {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  const c = must(await svc.rpc('quoco_test_capture_cleanup', { p_tenant_id: st.tenant }), 'capture cleanup')
  console.log('quoco_test_capture_cleanup ->', JSON.stringify(c))
  must(await svc.from('jobs').delete().eq('type', 'capture_ingest').contains('payload', { tenant_id: st.tenant }), 'jobs')
  must(await svc.from('daily_logs').delete().eq('tenant_id', st.tenant), 'daily_logs')
  must(await svc.from('processed_messages').delete().like('message_sid', st.sidPrefix + '%'), 'processed_messages')
  must(await svc.from('whatsapp_sessions').delete().in('phone_number', [st.phoneInFlight, st.phoneFlag]), 'sessions')
  must(await svc.from('project_members').delete().eq('tenant_id', st.tenant), 'members')
  must(await svc.from('projects').delete().eq('tenant_id', st.tenant), 'projects')
  must(await svc.from('users').delete().eq('tenant_id', st.tenant), 'users')
  must(await svc.from('tenants').delete().eq('id', st.tenant), 'tenant')
  const left = [await svc.from('tenants').select('id').eq('id', st.tenant), await svc.from('users').select('id').eq('tenant_id', st.tenant), await svc.from('whatsapp_sessions').select('phone_number').in('phone_number', [st.phoneInFlight, st.phoneFlag])]
  console.log('seed rows left (tenants, users, sessions):', left.map((x) => (x.data ?? []).length).join(', '))
}
