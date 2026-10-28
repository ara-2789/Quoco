// Engineer-facing strings for the material-inward (DC / invoice) capture flow:
// docs/plans/pr-c-plan.md section 7, all 21 rows. C3 added rows 1, 20, 21; C4a adds rows 2-19.
//
// Composition (plan section 7), "\n" separator, same as buildIdleReply:
//   S-3 reply     = MI_CHECKIN_PHOTO_NOT_SAVED_REPLY + "\n" + CHECKIN_RESET_EXPLAIN_REPLY + "\n" + <current check-in question>
//   N13 deferral  = CHECKIN_RESET_EXPLAIN_REPLY + "\n" + <step-1 question>
//   file + prompt = MI_FILE_RECEIVED(n) + "\n" + <ack question | note prompt>
//   re-asks       = MI_KIND_REASK / MI_ACK_REASK + "\n" + <the same question>
//
// Every constant here is approved text. Do not add a string without Aravind's approval (T-STR-2 fails on any
// exported MI_* / CHECKIN_* name outside the approved set).

// Row 1. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_SESSION_ENDED_REPLY =
  'That DC or invoice question has ended. Your answer was not recorded. Reply 4 to start again.'

// Row 2. APPROVED 2026-10-26 (Aravind). Tamil owed. Defined, unused until C6 (the idle menu does not carry it).
export const MI_MENU_LINE = 'You can send a DC or invoice — reply 4.'

// Row 3. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ASK_KIND = 'Is it a DC or an invoice?\nReply 1 for DC\nReply 2 for invoice'

// Row 4. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ASK_FILE_DC = 'Send one DC. A PDF, or photos of all its pages together.'

// Row 5. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ASK_FILE_INVOICE = 'Send one invoice. A PDF, or photos of all its pages together.'

// Row 6. APPROVED 2026-10-26 (Aravind). Tamil owed. One function, two approved texts (n = 1, n > 1).
export function MI_FILE_RECEIVED(n: number): string {
  return n === 1 ? '✅ 1 file received.' : `✅ ${n} files received.`
}

// Row 7. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ACK_QUESTION_DC =
  'Did the material on this DC arrive?\nReply 1 for all arrived\nReply 2 for not arrived\nReply 3 for part arrived'

// Row 8. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ACK_QUESTION_INVOICE =
  'Does this invoice match the material received at site?\nReply 1 for matches\nReply 2 for does not match\nReply 3 for partly matches'

// Row 9. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ASK_NOTE_NO = 'What is wrong? Describe it in your own words.'

// Row 10. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_ASK_NOTE_PARTIAL = 'What is missing or different? Describe it in your own words.'

// Row 11. APPROVED 2026-10-26 (Aravind). Tamil owed. Followed by "\n" and the same ack question.
export const MI_ACK_REASK = "Sorry, I didn't catch that."

// Row 12. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_NOT_UNDERSTOOD_CLOSE = '✅ Your reply is recorded as a note. Your Project Manager will see it.'

// Row 13. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_DONE = '✅ Done. Your Project Manager will see it. To send another DC or invoice, reply 4.'

// Row 14. APPROVED 2026-10-26 (Aravind). Tamil owed. Followed by "\n" and MI_ASK_KIND.
export const MI_KIND_REASK = "Sorry, I didn't catch that."

// Row 15. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_FILE_REASK = "Sorry, I didn't get a file. Send a PDF, or photos of all its pages."

// Row 16. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_NOTHING_RECORDED_CLOSE = 'Nothing was recorded. To send a DC or invoice, reply 4.'

// Row 17. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_UNSUPPORTED_FILE_REPLY =
  "This file type isn't supported. Nothing was recorded. Send a PDF or a photo instead."

// Row 18. APPROVED 2026-10-26 (Aravind). Tamil owed. Defined, unused until C4b / C6.
export const MI_IDLE_DOCUMENT_NUDGE = 'File not saved. To send a DC or invoice, reply 4 first.'

// Row 19. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_CAPTURE_FAILED_REPLY = "Sorry, I couldn't receive that file. Please send it again."

// Row 20. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const CHECKIN_RESET_EXPLAIN_REPLY =
  'Your DC or invoice was stopped for the check-in. Files already received are kept.'

// Row 21. APPROVED 2026-10-26 (Aravind). Tamil owed.
export const MI_CHECKIN_PHOTO_NOT_SAVED_REPLY = 'Photo not saved.'
