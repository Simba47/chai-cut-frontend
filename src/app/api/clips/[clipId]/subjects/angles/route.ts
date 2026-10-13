import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getAngles, scanAngles } from '@/server/services/subjects'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The clip's camera angles (editor Subjects tool): the list, or how the scan is going
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await getAngles(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}

// Look for the angles through the clip: { start_ms, end_ms } of the source video
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await scanAngles(user.id, clipId, body))
  } catch (err) {
    return apiError(err)
  }
}
