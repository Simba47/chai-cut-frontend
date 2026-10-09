import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { requestProxy } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The editor opened a video that has no editing copy yet: ask the worker to make one
export async function POST(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(videoId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await requestProxy(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}
