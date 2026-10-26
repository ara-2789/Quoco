// Engineer-facing strings for the material-inward (DC / invoice) capture flow
// that PR-C C3 uses. Only the three constants C3 needs live here; C4 adds the
// rest of docs/plans/pr-c-plan.md section 7's table.
//
// Composition (plan section 7), "\n" separator, same as buildIdleReply:
//   S-3 reply     = MI_CHECKIN_PHOTO_NOT_SAVED_REPLY + "\n" + CHECKIN_RESET_EXPLAIN_REPLY + "\n" + <current check-in question>
//   N13 deferral  = CHECKIN_RESET_EXPLAIN_REPLY + "\n" + <step-1 question>

// APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_SESSION_ENDED_REPLY =
  'That DC or invoice question has ended. Your answer was not recorded. Reply 4 to start again.'

// APPROVED 2026-10-26 (Aravind). Tamil owed.
export const CHECKIN_RESET_EXPLAIN_REPLY =
  'Your DC or invoice was stopped for the check-in. Files already received are kept.'

// APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_CHECKIN_PHOTO_NOT_SAVED_REPLY = 'Photo not saved.'
