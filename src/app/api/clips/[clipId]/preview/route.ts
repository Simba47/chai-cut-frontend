import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getClipPreview } from '@/server/services/clipPreview'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// What the clip board's Preview needs to play a clip as edited (no export)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await getClipPreview(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}
