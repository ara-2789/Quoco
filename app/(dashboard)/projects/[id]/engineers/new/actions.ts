'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { isUuid } from '@/lib/engineers/gate'
import {
  previewEngineers,
  readApplyFields,
  submitApply,
  type EngineerFormState,
} from '@/lib/engineers/add-engineers'

// Add-engineer slice 1, PR A. THIN by design: this file only resolves the
// caller's client, validates the raw form fields by hand (no schema library,
// decision D-A7), calls lib/engineers/add-engineers.ts -- where everything
// testable lives -- and revalidates. It cannot be loaded under vitest
// ('server-only' via getProfile), so its wiring is exercised by hand only
// (a stated coverage limit, decision D-A9 / plan U16).
//
// Authorisation is NOT decided here: add_engineers_to_project re-runs the gate
// and every classification on every call (plan section 2.2). getProfile() is
// called for its side effect -- it redirects an unauthenticated caller.
//
// SENTRY carries a feature tag and, at most, a SQLSTATE -- never a number, a
// name or the pasted text.

const MAX_RAW_LENGTH = 50_000

function failure(error: 'projectNotFound' | 'unexpected', raw: string): EngineerFormState {
  return { kind: 'error', nonce: crypto.randomUUID(), raw, error, code: null }
}

function text(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.length <= MAX_RAW_LENGTH ? value : null
}

function reportUnexpected(state: EngineerFormState) {
  if (state.kind === 'error' && state.error === 'unexpected') {
    Sentry.captureMessage('add engineers: unexpected outcome', {
      level: 'error',
      tags: { feature: 'add-engineers' },
      extra: { sqlstate: state.code },
    })
  }
}

function reportThrown(e: unknown) {
  Sentry.captureMessage('add engineers: action threw', {
    level: 'error',
    tags: { feature: 'add-engineers' },
    extra: { errorName: e instanceof Error ? e.name : typeof e },
  })
}

export async function previewEngineersAction(formData: FormData): Promise<EngineerFormState> {
  await getProfile() // enforces auth -- redirects to /login if unauthenticated
  const projectId = text(formData.get('projectId'))
  const raw = text(formData.get('raw'))
  if (projectId === null || !isUuid(projectId)) return failure('projectNotFound', '')
  if (raw === null) return failure('unexpected', '')

  try {
    const state = await previewEngineers(await createClient(), projectId, raw)
    reportUnexpected(state)
    return state
  } catch (e) {
    reportThrown(e)
    return failure('unexpected', raw)
  }
}

export async function applyEngineersAction(formData: FormData): Promise<EngineerFormState> {
  await getProfile() // enforces auth -- redirects to /login if unauthenticated
  const projectId = text(formData.get('projectId'))
  const raw = text(formData.get('raw'))
  if (projectId === null || !isUuid(projectId)) return failure('projectNotFound', '')
  if (raw === null) return failure('unexpected', '')

  try {
    const client = await createClient()
    const input = readApplyFields({
      carried: formData.get('carried'),
      pasted: formData.get('pasted'),
      consent: formData.get('consent'),
    })
    let state: EngineerFormState
    if (input === null) {
      // A malformed hidden field is treated as a changed list: re-preview.
      const preview = await previewEngineers(client, projectId, raw)
      state = preview.kind === 'preview' ? { ...preview, notice: 'list_changed' } : preview
    } else {
      state = await submitApply(client, projectId, raw, input)
    }
    reportUnexpected(state)
    if (state.kind === 'applied') revalidatePath(`/projects/${projectId}`)
    return state
  } catch (e) {
    reportThrown(e)
    return failure('unexpected', raw)
  }
}
