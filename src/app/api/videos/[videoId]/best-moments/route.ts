import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { addBestMoments } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Find best moments": AI finds new moments and saves each as a draft clip (Best moments section)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await addBestMoments(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}
