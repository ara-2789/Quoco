import { normaliseField, type PmDetailsFields } from '@/lib/capture/pm-actions'

// The set-details form builds what it SENDS here, as a pure function, so it can be tested in node.
//
// VEHICLE PASS-THROUGH (PR-D1b): the form no longer has a vehicle field, but pm_set_delivery_details overwrites all four
// fields and an empty value clears one (050:456). So the vehicle that was LOADED is always sent back unchanged. It is never
// read from form state.

export interface DetailsForm {
  deliveryType: string
  dcNumber: string
  dcDate: string
}

export function buildDetailsNext(loaded: PmDetailsFields, form: DetailsForm): PmDetailsFields {
  return {
    deliveryType: form.deliveryType,
    vehicleNumber: loaded.vehicleNumber,
    dcNumber: form.dcNumber,
    dcDate: form.dcDate,
  }
}

/** True while the form shows something other than the loaded values. Compared as the server compares: trimmed, empty = none. */
export function isDetailsDirty(loaded: PmDetailsFields, form: DetailsForm): boolean {
  return (
    normaliseField(loaded.deliveryType) !== normaliseField(form.deliveryType) ||
    normaliseField(loaded.dcNumber) !== normaliseField(form.dcNumber) ||
    normaliseField(loaded.dcDate) !== normaliseField(form.dcDate)
  )
}
