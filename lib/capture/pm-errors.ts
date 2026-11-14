import { PM_ERR_MESSAGES, type PmErrKey } from './pm-copy'

// PR-D error map (draft 3 section 6, D11). The 050 PM functions raise ERRCODE 'QE0nn' with MESSAGE 'En' and nothing
// else (049 legend, supabase/migrations/049_capture_tables.sql:149-168; "The app maps code -> named string"). PostgREST
// returns that SQLSTATE in `error.code`.
//
// QE015 is ONE shape for every refusal (not found, not your project, bad input, foreign id): the page never says
// which. QE011 is the one code whose meaning depends on the action, so the action is an input.

export type PmActionName = 'set_details' | 'approve' | 'reject' | 'link' | 'unlink' | 'classify'

export function mapPmRpcError(action: PmActionName, code: string | null | undefined): PmErrKey {
  // PR-D2 (D6): classify has its own closed table. QE015 (not found / not a PM of the project / null id, 052:339,350,364) and QE011 (the
  // document already has a DIFFERENT kind, 052:248-250) are the only expected refusals. QE009 is unreachable through the RPC, QE012 cannot
  // be sent by this UI, QE014 is an isolation-level guard, 23xxx are constraint errors: all of them, and anything unknown, are the
  // reported catch-all. The raw database text is never part of the result.
  if (action === 'classify') {
    if (code === 'QE015') return 'PM_ERR_CLASSIFY_NOT_AVAILABLE'
    if (code === 'QE011') return 'PM_ERR_CLASSIFY_OTHER_KIND'
    return 'PM_ERR_CLASSIFY_FAILED'
  }
  switch (code) {
    case 'QE015':
      return 'PM_ERR_NOT_AVAILABLE'
    case 'QE011':
      if (action === 'link') return 'PM_ERR_LINK_AUTO_APPROVED' // linking while the automatic delivery is approved (050:869-870)
      if (action === 'unlink') return 'PM_ERR_ALREADY_UNLINKED' // link no longer active (050:968-971)
      return 'PM_ERR_STATE_CHANGED'
    case 'QE016':
      return 'PM_ERR_TYPE_REQUIRED'
    case 'QE017':
      return 'PM_ERR_REJECT_REASON'
    case 'QE012':
    case '23514':
    case '23503':
      return 'PM_ERR_INVALID_INPUT'
    case 'QE008':
      return 'PM_ERR_ALREADY_LINKED'
    case 'QE010':
      return 'PM_ERR_SELF_LINK_FIXED'
    case 'QE006':
      return 'PM_ERR_RETYPE_LINKED'
    case 'QE007':
      return 'PM_ERR_RETYPE_AUTOMATIC'
    case 'QE003':
    case 'QE004':
    case 'QE005':
      return 'PM_ERR_LINK_TARGET_INELIGIBLE'
    default:
      // QE001/002/009/013/014 should be unreachable through the five functions; anything else is unknown.
      return 'PM_ERR_SAVE_FAILED'
  }
}

/** Only the catch-all is reported to Sentry: every other key is an expected, user-visible refusal. */
export function isReportableErr(key: PmErrKey): boolean {
  return key === 'PM_ERR_SAVE_FAILED' || key === 'PM_ERR_CLASSIFY_FAILED'
}

export type PmActionError = { status: 'error'; key: PmErrKey; message: string }
export type PmActionResult = { status: 'ok' } | PmActionError

export function pmError(key: PmErrKey): PmActionError {
  return { status: 'error', key, message: PM_ERR_MESSAGES[key] }
}
