import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { createAutoClips, getAutoClips } from '@/server/services/videos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Make my clips": start the AI Edit job for this video
export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  const clipCount = body?.clip_count === undefined ? 5 : Number(body.clip_count)
  try {
    return NextResponse.json(await createAutoClips(user.id, videoId, clipCount, body?.add_broll === true))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}

// The latest AI Edit job for this video (status, progress, error) and its clips
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await getAutoClips(user.id, videoId))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
