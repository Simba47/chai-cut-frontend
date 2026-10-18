import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getSilences, scanSilences } from '@/server/services/silences'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The clip's silences (editor Cleanup tool): the list, or how the scan is going
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  const { clipId } = await params
  try {
    return NextResponse.json(await getSilences(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}

// Look for silences through the clip: { start_ms, end_ms } of the source video
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await scanSilences(user.id, clipId, body))
  } catch (err) {
    return apiError(err)
  }
}
