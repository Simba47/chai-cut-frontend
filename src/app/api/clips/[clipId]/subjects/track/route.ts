import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { trackSubjects } from '@/server/services/subjects'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Follow the marked subjects through the clip: { start_ms, end_ms } of the source video, all?: track every one again
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ subjects: await trackSubjects(user.id, clipId, body) })
  } catch (err) {
    return apiError(err)
  }
}
