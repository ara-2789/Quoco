// P1b: PostgREST probes against TEST-DB with real keys. No key is printed. Every UPDATE filters on a random uuid, so no capture_files row can match.
// The only writes are one throwaway auth user (+ its public.users stub), created to get a real authenticated JWT and deleted at the end.
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const ROOT = '/Users/aravindanrajamani/Desktop/quocoai/.claude/worktrees/c2-capture-files-lock'
const req = createRequire(ROOT + '/package.json')
const dotenv = req('dotenv')
const { createClient } = req('@supabase/supabase-js')
dotenv.config({ path: '/Users/aravindanrajamani/Desktop/quocoai/.env.test', quiet: true })

const url = process.env.SUPABASE_TEST_URL
const svcKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const EXPECT = 'exfccwlrhoutkgrlikod'
function claims(jwt) { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) }
const log = (...a) => console.log(...a)

async function main() {
  log('== P1b PostgREST probes on test-db ==')
  log('generated:', new Date().toISOString())
  const host = new URL(url).host
  log('host:', host, host === EXPECT + '.supabase.co' ? '(= test-db)' : '(MISMATCH)')
  const ac = claims(anonKey), sc = claims(svcKey)
  log('anon key claims: ref=' + ac.ref + ' role=' + ac.role, '| service key claims: ref=' + sc.ref + ' role=' + sc.role)
  if (host !== EXPECT + '.supabase.co' || ac.ref !== EXPECT || sc.ref !== EXPECT || ac.role !== 'anon' || sc.role !== 'service_role') { log('STOP: host or key claims do not match test-db'); process.exit(3) }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } }
  const svc = createClient(url, svcKey, opts)
  const anon = createClient(url, anonKey, opts)
  const nomatch = () => randomUUID()
  const res = []
  const rec = (label, r, expect) => {
    const code = r.error ? r.error.code : null
    const rows = r.data == null ? null : r.data.length
    const ok = expect === 'ok' ? !r.error : code === expect
    res.push(ok)
    log((ok ? 'PASS' : 'FAIL') + ': ' + label + ' -> error.code=' + code + (r.error ? ' message="' + r.error.message + '"' : '') + ' rows_returned=' + rows)
  }

  log('\n-- anon (real anon key)')
  rec('anon UPDATE ingest_status (no row matches)', await anon.from('capture_files').update({ ingest_status: 'failed' }).eq('id', nomatch()).select('id'), '42501')
  rec('anon UPDATE file_no (no row matches)', await anon.from('capture_files').update({ file_no: 99 }).eq('id', nomatch()).select('id'), '42501')
  rec('anon UPDATE ingested_at (no row matches)', await anon.from('capture_files').update({ ingested_at: new Date().toISOString() }).eq('id', nomatch()).select('id'), '42501')
  rec('anon rpc trg_capture_files_before_update', await anon.rpc('trg_capture_files_before_update'), '42501')

  log('\n-- service_role')
  rec('service_role UPDATE file_no (not granted; no row matches)', await svc.from('capture_files').update({ file_no: 99 }).eq('id', nomatch()).select('id'), '42501')
  rec('service_role UPDATE ingested_at (not granted; no row matches)', await svc.from('capture_files').update({ ingested_at: new Date().toISOString() }).eq('id', nomatch()).select('id'), '42501')
  rec('CONTROL service_role UPDATE ingest_status (granted; no row matches => 0 rows, no error)', await svc.from('capture_files').update({ ingest_status: 'failed' }).eq('id', nomatch()).select('id'), 'ok')
  rec('service_role DELETE (no grant; no row matches)', await svc.from('capture_files').delete().eq('id', nomatch()), '42501')
  rec('service_role rpc trg_capture_files_before_update', await svc.rpc('trg_capture_files_before_update'), '42501')

  log('\n-- authenticated (a throwaway auth user, so the JWT is a real authenticated one)')
  const email = 'zz-test-capture-p1-' + randomUUID() + '@example.invalid'
  const password = 'zz-p1-' + randomUUID()
  let userId = null
  try {
    const cu = await svc.auth.admin.createUser({ email, password, email_confirm: true })
    if (cu.error || !cu.data.user) throw new Error('createUser failed: ' + (cu.error && cu.error.message))
    userId = cu.data.user.id
    log('created throwaway auth user (id ' + userId + ')')
    const pm = createClient(url, anonKey, opts)
    const si = await pm.auth.signInWithPassword({ email, password })
    if (si.error) throw new Error('signIn failed: ' + si.error.message)
    const c = claims(si.data.session.access_token)
    log('session JWT claims: role=' + c.role + ' ref-from-iss=' + String(c.iss).split('//')[1].split('.')[0])
    rec('authenticated UPDATE ingest_status (no row matches)', await pm.from('capture_files').update({ ingest_status: 'failed' }).eq('id', nomatch()).select('id'), '42501')
    rec('authenticated UPDATE file_no (no row matches)', await pm.from('capture_files').update({ file_no: 99 }).eq('id', nomatch()).select('id'), '42501')
    rec('authenticated rpc trg_capture_files_before_update', await pm.rpc('trg_capture_files_before_update'), '42501')
  } finally {
    if (userId) {
      const d1 = await svc.from('users').delete().eq('auth_id', userId).select('id')
      log('cleanup: public.users stub rows deleted =', d1.error ? 'ERROR ' + d1.error.message : d1.data.length)
      const d2 = await svc.auth.admin.deleteUser(userId)
      log('cleanup: auth user deleted =', d2.error ? 'ERROR ' + d2.error.message : 'yes')
      const chk = await svc.from('users').select('id').eq('auth_id', userId)
      log('cleanup check: public.users rows for that auth id =', chk.error ? 'ERROR ' + chk.error.message : chk.data.length)
    }
  }
  const cnt = await svc.from('capture_files').select('id', { count: 'exact', head: true })
  log('\ncapture_files total rows after the probes (must be 0):', cnt.error ? 'ERROR ' + cnt.error.message : cnt.count)
  log('RESULT:', res.every(Boolean) ? 'ALL ' + res.length + ' PASS' : 'FAILURES PRESENT (' + res.filter((x) => !x).length + ' of ' + res.length + ')')
}
main().catch((e) => { console.log('SCRIPT ERROR:', e.message); process.exit(1) })
