// Hard allowlist guard — runs ONCE via vitest globalSetup, before any test.
//
// ALLOWLIST, not blocklist: the ONE permitted target is the test-db branch
// ref below. Anything else — production, staging, a typo, an empty value —
// aborts the entire run. The production ref is never named or special-cased;
// it simply is not the single allowed value. Every check throws (hard abort),
// so not a single DB call happens against a non-test database.

const ALLOWED_TEST_REF = 'exfccwlrhoutkgrlikod'

// Supabase project URLs are https://<ref>.supabase.co
function refFromUrl(url: string): string | null {
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)
  return m ? m[1] : null
}

export default function guard(): void {
  const url = process.env.SUPABASE_TEST_URL
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  const declaredRef = process.env.SUPABASE_TEST_PROJECT_REF

  if (!url || !key || !declaredRef) {
    throw new Error(
      '[guard] ABORT: .env.test is missing SUPABASE_TEST_URL, ' +
        'SUPABASE_TEST_SERVICE_ROLE_KEY, or SUPABASE_TEST_PROJECT_REF. ' +
        'Refusing to run.',
    )
  }

  const urlRef = refFromUrl(url)
  if (!urlRef) {
    throw new Error(
      `[guard] ABORT: SUPABASE_TEST_URL is not a recognisable Supabase URL: ${url}`,
    )
  }

  // The single gate: resolved ref MUST be the test-db branch.
  if (urlRef !== ALLOWED_TEST_REF) {
    throw new Error(
      `[guard] ABORT: resolved project ref "${urlRef}" is not the allowed ` +
        `test-db ref "${ALLOWED_TEST_REF}". Refusing to run against a ` +
        'non-test database.',
    )
  }

  // Belt-and-braces: the declared ref must also be the allowed one AND agree
  // with the URL, so a mismatched copy-paste (right URL, wrong key/ref) fails.
  if (declaredRef !== ALLOWED_TEST_REF) {
    throw new Error(
      `[guard] ABORT: SUPABASE_TEST_PROJECT_REF "${declaredRef}" is not the ` +
        `allowed test-db ref "${ALLOWED_TEST_REF}".`,
    )
  }
  if (urlRef !== declaredRef) {
    throw new Error(
      '[guard] ABORT: SUPABASE_TEST_PROJECT_REF does not match the ref in ' +
        'SUPABASE_TEST_URL.',
    )
  }
}
