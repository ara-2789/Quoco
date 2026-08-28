// Pass 1 item E, morning half. CHECKIN_CHECKPOINTS.morningSend (08:30
// IST) trigger -- calls runCheckpointTrigger (lib/whatsapp/outbound/
// checkpoint-trigger.ts) for every active project's morning roster.
// Thin wrapper only, same shape as app/api/cron/dpr-generate/route.ts's
// own GET: auth, resolve today's IST date, call the real logic, return
// its result as JSON. All real logic (roster iteration, the 3-attempt
// retry budget, the loud exhaustion alert) lives in checkpoint-trigger.ts,
// not here.
//
// NOT YET WIRED INTO vercel.json -- see that file's own state and
// docs/plans/pass1-outbound-send-plan.md's "Two hard preconditions"
// section. This route existing and being callable does not mean it is
// being called on a schedule.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isCronRequestAuthorized } from '@/lib/cron/auth'
import { istDateString } from '@/lib/daily-logs/date'
import { runCheckpointTrigger } from '@/lib/whatsapp/outbound/checkpoint-trigger'

export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const logDate = istDateString(new Date())
  try {
    const summary = await runCheckpointTrigger(createServiceClient(), 'morning_send', logDate)
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
