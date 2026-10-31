import type { NextRequest, NextResponse } from 'next/server'
import { handleCaptureFileGet } from '@/lib/capture/pm-file-access'

// PR-D (D2): never cached. The handler also sets Cache-Control: no-store and Referrer-Policy: no-referrer on every
// response. All logic and the reasons for this separate route are in lib/capture/pm-file-access.ts.
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
  return handleCaptureFileGet(request, await context.params)
}
