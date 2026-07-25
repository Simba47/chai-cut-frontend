import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listVideos } from '@/server/services/videos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const videos = await listVideos(user.id)
    return NextResponse.json({ videos })
  } catch (err: unknown) {
    const e = err as { message?: string }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: 500 })
  }
}
