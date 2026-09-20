// Approved English wording for the add-site-engineers flow. Strings only:
// {n} and {project name} are placeholders left for the caller to fill — no
// pluralisation, zero-suppression or formatting logic belongs in this file.
//
// Deliberate, do not "fix":
//   - There is exactly ONE "already in use" rejection (`inUse`). Two
//     distinguishable messages would reveal whether a number belongs to
//     another company.
//   - No string implies a removal, edit or undo path; this slice has none.
//   - `statusStopped` is unreachable in this slice and kept on purpose.

export const page = {
  title: 'Add site engineers',
  intro:
    'Add the site engineers who will send daily reports on WhatsApp for this project.',
  formatHelp:
    'One person per line: name, then WhatsApp number. Example: Suresh Kumar, +919876543210',
  textareaLabel: 'Names and numbers',
  previewButton: 'Check list',
  applyButton: 'Add to project',
  editButton: 'Go back and edit',
} as const

export const preview = {
  summary: '{n} will be added. {n} cannot be added.',
  accepted: 'Will be added',
  rejected: 'Cannot be added',
  nothingToApply:
    'Nothing on this list can be added. Fix the lines above and check again.',
} as const

export const rejections = {
  noName: 'No name on this line.',
  nameTooLong: 'Name is too long. Keep it under {n} letters.',
  badNumber: 'Not a valid Indian mobile number. Use +91 and 10 digits.',
  duplicateInPaste: 'This number is already on the list above.',
  alreadyOnThisProject: 'Already on this project.',
  onAnotherProject: 'Already on {project name}.',
  inUse: 'This number is already in use. It cannot be added.',
} as const

export const confirm = {
  question: 'Add {n} site engineers to this project?',
  attestation:
    'I have checked these numbers, and these people know they will get WhatsApp messages from Quoco.',
} as const

export const result = {
  summary: '{n} added. {n} not added.',
  rowAdded: 'Added',
  batchFailed: 'Nothing was added. Please check the list and try again.',
} as const

export const errors = {
  projectNotFound: 'This project was not found.',
  notAllowed: 'You cannot add people to this project.',
  emptyList: 'Add at least one name and number.',
  tooManyLines: 'Too many lines. Add up to {n} at a time.',
  unexpected: 'Something went wrong. Nothing was added. Please try again.',
  listChanged: 'The list changed. Please check it again before adding.',
} as const

export const list = {
  addLink: 'Add site engineers',
  title: 'Site engineers',
  empty: 'No site engineers on this project yet.',
  statusActive: 'Active',
  statusStopped: 'Stopped',
  statusNotActive: 'Not active',
} as const
