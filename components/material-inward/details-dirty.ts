import { createContext } from 'react'

// R1 (PR-D1b): true while the set-details form differs from the loaded values. DetailsControls provides it; DecisionControls
// reads it and disables Approve and Reject, so a PM cannot decide on values that are not saved yet. Default false: a
// DecisionControls rendered on its own (a test) behaves as before.
export const DetailsDirtyContext = createContext(false)
