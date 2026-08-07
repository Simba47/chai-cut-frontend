import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getVideo, deleteVideo } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await getVideo(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    await deleteVideo(user.id, videoId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
