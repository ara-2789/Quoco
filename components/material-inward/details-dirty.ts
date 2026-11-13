import { createContext } from 'react'
import type { PmDetailsFields } from '@/lib/capture/pm-actions'
import { normaliseField } from '@/lib/capture/pm-actions'
import type { DetailsForm } from './details-next'

// R1 (PR-D1b): true while the set-details form differs from the loaded values. DetailsControls provides it; DecisionControls
// reads it and disables Approve and Reject, so a PM cannot decide on values that are not saved yet. Default false: a
// DecisionControls rendered on its own (a test) behaves as before.
export const DetailsDirtyContext = createContext(false)

/** N1 (review round 1): true while an unsaved edit sits in a field inside "More details (optional)" (DC no. or DC date). */
export function isMoreDetailsDirty(loaded: PmDetailsFields, form: DetailsForm): boolean {
  return normaliseField(loaded.dcNumber) !== normaliseField(form.dcNumber) || normaliseField(loaded.dcDate) !== normaliseField(form.dcDate)
}
