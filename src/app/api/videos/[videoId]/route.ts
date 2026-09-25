import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getVideo, deleteVideo, renameVideo } from '@/server/services/videos'
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  if (typeof body?.title !== 'string') return NextResponse.json({ error: 'title required' }, { status: 400 })
  try {
    return NextResponse.json(await renameVideo(user.id, videoId, body.title))
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
